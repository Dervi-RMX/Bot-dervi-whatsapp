const fs = require('fs');
const path = require('path');
const {
  getMessageText, getMediaInfo,
  extractUrls,
  getQuotedMessage,
  isQuotedMessage,
  getMessageContent,
  getContentType,
  ensureDir,
  sleep,
  normalizeText
} = require('./lib/utils');
const { detectMessageContent } = require('./lib/content-detector');
const { downloadQuotedMedia, downloadUrlToTempFile, cleanupTempFiles } = require('./lib/downloader');
const { buildOutboundPayload, formatMediaInfo, inferOutboundKindFromMime } = require('./lib/media');
const { ModerationManager, normalizeJid } = require('./lib/moderation');
const { AccessManager } = require('./lib/access-manager');
const { createDataStore } = require('./lib/data-store');
const logger = require('./lib/logger');
const { getStatsManager } = require('./lib/stats');
const { createTempCleaner } = require('./lib/temp-cleaner');
const { getProfileStore } = require('./lib/profile');

function sameWhatsAppPhone(left, right) {
  const normalize = value => {
    const normalized = normalizeJid(value);
    const at = normalized.indexOf('@');
    if (at === -1 || normalized.slice(at + 1) !== 's.whatsapp.net') return normalized;
    const number = normalized.slice(0, at);
    return /^1\d{10}$/.test(number) ? number.slice(1) : number;
  };

  const leftValue = normalize(left);
  const rightValue = normalize(right);
  return Boolean(leftValue) && leftValue === rightValue;
}

class CommandHandler {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.dataStore = createDataStore(config.dataDirectory);
    this.plugins = new Map();
    this.rateMap = new Map();
    this.loading = false;
    this.activeProcessing = new Map(); // track active "processing" messages per chat
    this.groupInfoCache = new Map(); // chatId -> { admins:Set, botIsAdmin:boolean, expires:number }
    this.moderation = new ModerationManager(config);
    this.access = new AccessManager(config);
    this.stats = getStatsManager(config.dataDirectory);
    this.profiles = getProfileStore(config.dataDirectory);
    this.tempCleaner = createTempCleaner(config.tempDirectory, { maxAgeMs: config.tempFileMaxAgeMs });
    this.persistentOwners = [];
    this.bannedUsers = new Set();
    this.loadPersistentOwners();
    this.loadBannedUsers();
  }

  loadPersistentOwners() {
    try {
      const parsed = this.dataStore.read('owners.json', { owners: [] });
      if (Array.isArray(parsed.owners)) {
        this.persistentOwners = parsed.owners.map(owner => normalizeJid(owner)).filter(Boolean);
      }
    } catch (error) {
      logger.warning('Failed to load persistent owners', { error: error.message });
      this.persistentOwners = [];
    }
  }

  savePersistentOwners() {
    try {
      this.dataStore.write('owners.json', { owners: this.persistentOwners });
    } catch (error) {
      logger.warning('Failed to save persistent owners', { error: error.message });
    }
  }

  addPersistentOwner(ownerJid) {
    const normalized = normalizeJid(ownerJid);
    if (!normalized) return false;
    if (!this.persistentOwners.includes(normalized)) {
      this.persistentOwners.push(normalized);
      this.savePersistentOwners();
      return true;
    }
    return false;
  }

  removePersistentOwner(ownerJid) {
    const normalized = normalizeJid(ownerJid);
    if (!normalized) return false;
    const index = this.persistentOwners.indexOf(normalized);
    if (index === -1) return false;
    const mainOwner = normalizeJid(this.config.ownerJid || '');
    if (mainOwner && normalized === mainOwner) return false;
    this.persistentOwners.splice(index, 1);
    this.savePersistentOwners();
    return true;
  }

  loadBannedUsers() {
    try {
      const parsed = this.dataStore.read('bans.json', { bans: [] });
      if (Array.isArray(parsed.bans)) {
        this.bannedUsers = new Set(parsed.bans.map(ban => normalizeJid(ban)).filter(Boolean));
      }
    } catch (error) {
      logger.warning('Failed to load banned users', { error: error.message });
      this.bannedUsers = new Set();
    }
  }

  saveBannedUsers() {
    try {
      this.dataStore.write('bans.json', { bans: Array.from(this.bannedUsers) });
    } catch (error) {
      logger.warning('Failed to save banned users', { error: error.message });
    }
  }

  isBanned(jid) {
    const normalized = normalizeJid(jid);
    return !!normalized && this.bannedUsers.has(normalized);
  }

  async loadPlugins() {
    const pluginsDir = path.join(__dirname, 'plugins');
    ensureDir(pluginsDir);
    const files = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
    const next = new Map();
    const pluginNames = new Set();
    const pluginAliases = new Set();

    for (const file of files) {
      try {
        const fullPath = path.join(pluginsDir, file);
        delete require.cache[require.resolve(fullPath)];
        const plugin = require(fullPath);

        // Validate plugin has required properties
        if (!plugin || !plugin.name || typeof plugin.execute !== 'function') {
          logger.warning(`Plugin ${file} no tiene los requisitos necesarios (nombre y función execute)`, { file });
          continue;
        }

        const pluginName = plugin.name.toLowerCase();

        // Check for duplicate plugin names
        if (pluginNames.has(pluginName)) {
          logger.warning(`Nombre de plugin duplicado: ${plugin.name}. Usando la primera instancia.`, { pluginName });
          continue;
        }
        pluginNames.add(pluginName);

        // Check for duplicate aliases
        if (plugin.aliases) {
          for (const alias of plugin.aliases) {
            const aliasLower = String(alias).toLowerCase();
            if (pluginAliases.has(aliasLower)) {
              logger.warning(`Alias de plugin duplicado: ${alias}. Este alias será ignorado.`, { alias, pluginName });
              continue; // Skip this alias, but continue with the plugin
            }
            pluginAliases.add(aliasLower);
          }
        }

        // Add plugin to the map
        next.set(pluginName, plugin);

        // Add aliases to the map
        if (plugin.aliases) {
          for (const alias of plugin.aliases) {
            next.set(String(alias).toLowerCase(), plugin);
          }
        }

        logger.info(`Plugin cargado: ${plugin.name}`, { pluginName });
      } catch (error) {
        logger.error(`Error cargando plugin ${file}`, { error: error.message, file });
        // Continue with other plugins even if this one fails
        continue;
      }
    }

    this.plugins = next;
    return this.plugins.size;
  }

  async reloadPlugins() {
    return this.loadPlugins();
  }

  getPlugin(command) {
    return this.plugins.get(String(command || '').toLowerCase()) || null;
  }

  parseCommand(text) {
    const body = normalizeText(text);
    if (!body.startsWith(this.config.prefix)) return null;
    const withoutPrefix = normalizeText(body.slice(this.config.prefix.length));
    if (!withoutPrefix) return null;
    const [command, ...args] = withoutPrefix.split(/\s+/);
    return { command: command.toLowerCase(), args };
  }

  isRateLimited(sender) {
    const now = Date.now();
    const windowMs = this.config.rateLimitWindowMs;
    const max = this.config.rateLimitMax;
    const key = normalizeJid(sender) || String(sender || '');
    const bucket = this.rateMap.get(key) || [];
    const fresh = bucket.filter(ts => now - ts < windowMs);
    fresh.push(now);
    this.rateMap.set(key, fresh);
    return fresh.length > max;
  }

  async sendText(chatId, text, quoted) {
    return this.client.sendMessage(chatId, { text }, { quoted });
  }

  async reply(chatId, text, quoted) {
    return this.sendText(chatId, text, quoted);
  }

  async sendTempFile(chatId, filePath, meta, quoted) {
    const payload = buildOutboundPayload(filePath, meta);
    const result = await this.client.sendMessage(chatId, payload, { quoted });
    await fs.promises.unlink(filePath).catch(() => null);
    logger.success('✓ Archivo temporal eliminado', { file: path.basename(filePath) });
    return result;
  }

  async processQuotedOrCurrentMedia(message, chatId, quotedMessage, currentDetection, quoted) {
    const sourceMessage = quotedMessage || message;
    const detection = currentDetection || detectMessageContent(message);
    if (!detection || detection.type === 'unknown' || detection.type === 'text') {
      return null;
    }

    if (detection.type === 'url' && detection.url) {
      const filePath = await downloadUrlToTempFile(detection.url, this.config.tempDirectory, {
        maxBytes: this.config.maxFileSize,
        timeout: this.config.downloadTimeout
      });
      const meta = {
        fileName: path.basename(new URL(detection.url).pathname) || 'archivo',
        mimeType: '',
        kind: inferOutboundKindFromMime('')
      };
      return this.sendTempFile(chatId, filePath, meta, quoted);
    }

    const quotedMediaMessage = quotedMessage ? sourceMessage : getQuotedMessage(message) || sourceMessage;
    const filePath = await downloadQuotedMedia(quotedMediaMessage, this.config.tempDirectory);
    const media = getMediaInfo({ message: quotedMediaMessage });
    const meta = {
      fileName: media?.fileName || 'archivo',
      mimeType: media?.mimetype || '',
      kind: inferOutboundKindFromMime(media?.mimetype || ''),
      ptt: detection.type === 'audio'
    };
    return this.sendTempFile(chatId, filePath, meta, quoted);
  }

  async startProcessing(chatId, pluginName, quoted) {
    // show typing presence if possible
    try {
      if (typeof this.client.sendPresenceUpdate === 'function') {
        await this.client.sendPresenceUpdate('composing', chatId);
      }
    } catch (e) {
      // ignore presence errors
    }
    // no fallback message: keep chat clean and avoid "mensaje en espera"
    const current = this.activeProcessing.get(chatId);
    this.activeProcessing.set(chatId, {
      pluginName,
      startedAt: current?.startedAt || Date.now(),
      msgKey: null,
      count: (current?.count || 0) + 1
    });
    return { already: false, msgKey: null };
  }

  async stopProcessing(chatId) {
    // attempt to delete the invisible message and clear presence
    const entry = this.activeProcessing.get(chatId);
    try {
      if (entry && entry.msgKey) {
        try {
          await this.client.sendMessage(chatId, { delete: entry.msgKey });
        } catch (e) {
          // ignore delete errors
        }
      }
    } catch (e) {
      // ignore
    }

    const remaining = Math.max(0, (entry?.count || 1) - 1);
    if (remaining > 0) {
      this.activeProcessing.set(chatId, { ...entry, count: remaining });
      return;
    }

    try {
      if (typeof this.client.sendPresenceUpdate === 'function') {
        // pause typing and mark available only after the last task finishes
        await this.client.sendPresenceUpdate('paused', chatId).catch(() => null);
        await this.client.sendPresenceUpdate('available', chatId).catch(() => null);
      }
    } catch (e) {
      // ignore
    }

    this.activeProcessing.delete(chatId);
  }

  isGroupChat(chatId) {
    return String(chatId || '').endsWith('@g.us');
  }

  isOwnerIdentity(sender) {
    const connectedOwner = normalizeJid(this.client?.user?.id || '');
    const connectedLid = normalizeJid(this.client?.user?.lid || '');
    const owner = normalizeJid(this.config.ownerJid || (this.config.isSubbot ? connectedOwner : ''));
    const ownerLid = normalizeJid(this.config.ownerLid || '');
    const normalizedSender = normalizeJid(sender);

    // WhatsApp can identify the owner with a stable LID instead of the
    // configured phone-number JID.
    if (ownerLid && normalizedSender === ownerLid) return true;
    if (!owner) return false;
    if (normalizedSender === owner || sameWhatsAppPhone(normalizedSender, owner)) return true;

    // Check persistent owners
    if (this.persistentOwners.includes(normalizedSender)) return true;

    // Also accept the connected account's LID when that account matches the
    // configured owner number.
    return sameWhatsAppPhone(connectedOwner, owner)
      && Boolean(connectedLid)
      && normalizedSender === connectedLid;
  }

  isOwner(sender, aliases = []) {
    return [sender, ...aliases].some(candidate => this.isOwnerIdentity(candidate));
  }

  isLinked(sender, aliases = []) {
    return this.access.isLinked(sender, Date.now(), aliases);
  }

  isAuthorized(sender, aliases = []) {
    if (!this.config.requireLinkedUsers) return true;
    return this.isOwner(sender, aliases) || this.isLinked(sender, aliases);
  }

  async getGroupInfo(chatId, force = false) {
    const now = Date.now();
    const cached = this.groupInfoCache.get(chatId);
    if (!force && cached && cached.expires > now) return cached;

    const metadata = await this.client.groupMetadata(chatId);
    const participants = metadata?.participants || [];
    const admins = new Set(
      participants
        .filter(p => p?.admin === 'admin' || p?.admin === 'superadmin')
        .flatMap(p => [p.id, p.phoneNumber, p.jid])
        .map(normalizeJid)
        .filter(Boolean)
    );
    const botIds = [this.client?.user?.id, this.client?.user?.lid]
      .map(normalizeJid)
      .filter(Boolean);
    const botIsAdmin = botIds.some(id => admins.has(id));
    const value = { metadata, admins, botIsAdmin, expires: now + 30_000 };
    this.groupInfoCache.set(chatId, value);
    return value;
  }

  async isAdminInGroup(chatId, sender, aliases = []) {
    if (!this.isGroupChat(chatId)) return false;
    const info = await this.getGroupInfo(chatId);
    return [sender, ...aliases]
      .map(normalizeJid)
      .filter(Boolean)
      .some(candidate => info.admins.has(candidate));
  }

  async deleteGroupMessage(chatId, message) {
    if (!message?.key) return false;
    const groupInfo = await this.getGroupInfo(chatId);
    if (!groupInfo.botIsAdmin) return false;
    await this.client.sendMessage(chatId, { delete: message.key });
    return true;
  }

  async applyModerationAction(message, chatId, sender, result, reason = 'spam', aliases = []) {
    if (!result || result.action === 'none') return false;
    const targetJid = normalizeJid(sender);
    if (!targetJid) return false;
    const targetMention = `@${targetJid.split('@')[0]}`;
    const subject = reason === 'link' ? 'enlace no permitido' : 'spam';

    if (result.action === 'warn') {
      await this.client.sendMessage(
        chatId,
        {
          text: `⚠️ ${targetMention} ${subject} detectado. Aviso ${result.warnings}/${result.antiSpam.maxWarnings}.`,
          mentions: [targetJid]
        },
        { quoted: message }
      );
      return true;
    }

    if (result.action === 'ban') {
      const groupInfo = await this.getGroupInfo(chatId, true);
      if (!groupInfo.botIsAdmin) {
        await this.client.sendMessage(
          chatId,
          {
            text: `⚠️ ${targetMention} recibió el aviso ${result.warnings}/${result.antiSpam.maxWarnings} por ${subject}, pero necesito ser administrador para expulsarlo.`,
            mentions: [targetJent]
          },
          { quoted: message }
        );
        return true;
      }
      await this.client.groupParticipantsUpdate(chatId, [targetJid], 'remove');
      await this.client.sendMessage(
        chatId,
        {
          text: `🚫 ${targetMention} recibió el aviso ${result.warnings}/${result.antiSpam.maxWarnings} y fue expulsado por ${subject}.`,
          mentions: [targetJid]
        },
        { quoted: message }
      );
      return true;
    }

    return false;
  }

  async enforceGroupModeration(message, metadata, parsed) {
    const chatId = metadata.chatId;
    const sender = metadata.sender;
    if (!this.isGroupChat(chatId)) return false;
    if (this.isOwner(sender, metadata.senderAliases || [])) return false;
    if (await this.isAdminInGroup(chatId, sender, metadata.senderAliases || [])) return false;

    if (this.moderation.isMuted(chatId, sender, Date.now())) {
      await this.deleteGroupMessage(chatId, message).catch(error => {
        logger.warning('Muted message could not be deleted', { error: error?.message || String(error) });
      });
      return true;
    }

    if (parsed) return false;
    const body = normalizeText(getMessageText(message) || '');
    if (!body) return false;

    const antiLinks = this.moderation.getAntiLinks(chatId);
    if (!antiLinks.enabled || !extractUrls(body).length) return false;

    const deleted = await this.deleteGroupMessage(chatId, message);
    if (!deleted) {
      await this.reply(chatId, '⚠️ Detecté un enlace, pero necesito ser administrador para eliminarlo.', message);
      return true;
    }

    const result = this.moderation.registerWarning(chatId, sender);
    await this.applyModerationAction(message, chatId, sender, result, 'link');
    return true;
  }

  async enforceAntiSpam(message, metadata, parsed) {
    const chatId = metadata.chatId;
    const sender = metadata.sender;
    if (!this.isGroupChat(chatId)) return false;
    if (parsed) return false; // only plain messages, not commands

    const body = normalizeText(getMessageText(message) || '');
    if (!body) return false;

    if (this.isOwner(sender, metadata.senderAliases || [])) return false;
    if (await this.isAdminInGroup(chatId, sender, metadata.senderAliases || [])) return false;

    const result = this.moderation.evaluateMessage(chatId, sender, Date.now());
    if (result.action === 'none') return false;
    return this.applyModerationAction(message, chatId, sender, result, 'spam');
  }

  async handleMessage(message, metadata = {}) {
    const chatId = metadata.chatId;
    const sender = metadata.sender;
    const senderAliases = metadata.senderAliases || [];
    const quoted = metadata.quoted || null;
    const receivedAt = metadata.receivedAt || Date.now();
    const body = getMessageText(message).trim();
    const parsed = this.parseCommand(body);
    this.stats.recordMessage(sender, this.isGroupChat(chatId) ? chatId : null);
    this.profiles.recordMessage(
      [sender, ...senderAliases],
      { pushName: message?.pushName, name: message?.pushName }
    );
    if (parsed) this.stats.recordCommand(sender, this.isGroupChat(chatId) ? chatId : null);
    if (parsed) {
      this.profiles.recordCommand(
        [sender, ...senderAliases],
        { pushName: message?.pushName, name: message?.pushName }
      );
    }
    this.currentSender = sender;

    // Check if sender is banned
    if (this.isBanned(sender)) {
      // Silently ignore messages from banned users
      return;
    }

    try {
      const handled = await this.enforceGroupModeration(message, metadata, parsed);
      if (handled) return;
    } catch (error) {
      logger.warning('Group moderation check failed', { error: error?.message || String(error) });
    }

    try {
      const handled = await this.enforceAntiSpam(message, metadata, parsed);
      if (handled) return;
    } catch (error) {
      logger.warning('AntiSpam check failed', { error: error?.message || String(error) });
    }

    if (!parsed) {
      // This is a normal message (not a command)
      // Award XP for activity (with cooldown) if not the bot
      const botId = normalizeJid(this.client?.user?.id || '');
      const botLid = normalizeJid(this.client?.user?.lid || '');
      const normalizedSender = normalizeJid(sender);
      if (normalizedSender && normalizedSender !== botId && normalizedSender !== botLid) {
        const xpPlugin = this.plugins.get('xp');
        if (xpPlugin && typeof xpPlugin.awardActivityXP === 'function') {
          await xpPlugin.awardActivityXP(sender);
        }
      }
      // Silencio absoluto: solo respondemos a comandos explícitos con prefijo
      // Messages without prefix are ignored completely
      return;
    }

    const plugin = this.getPlugin(parsed.command);
    if (!plugin) {
      // Silencio absoluto: comandos desconocidos se ignoran completamente
      return;
    }

    const owner = this.isOwner(sender, senderAliases);
    const isGame = (() => {
      // Check explicit category
      if (plugin.category && typeof plugin.category === 'string' && plugin.category.toLowerCase() === 'games') {
        return true;
      }

      // Check name pattern
      const name = plugin.name.toLowerCase();
      return [
        'ppt',
        'quiz',
        'trivia',
        'dados',
        'adivinanza',
        'economy',
        'balance',
        'work',
        'pay'
      ].some(k => name.includes(k));
    })();
    const isSubbotPublicCommand = this.config.isSubbot === true
      && !plugin.ownerOnly
      && !plugin.adminOnly;
    const publicCommandNames = new Set(['play', 'clip', 'facebook', 'instagram', 'perfil']);
    const isPublicCommand = isGame
      || publicCommandNames.has(plugin.name.toLowerCase())
      || isSubbotPublicCommand;
    const allowReaction = owner || isPublicCommand;

    // Only games and .play are public; every other command is owner-only.
    if (!owner && !isPublicCommand) {
      // Silencio absoluto: los comandos no autorizados se ignoran completamente.
      return;
    }

    // Public commands still use their normal group/rate-limit checks.
    if (isPublicCommand) {
      if (!owner && this.isRateLimited(sender)) {
        return;
      }
      if (plugin.groupOnly && !this.isGroupChat(chatId)) {
        await this.reply(chatId, '⚠️ Este comando solo funciona en grupos.', quoted || message);
        return;
      }
    } else {
      // Rate limit (only applies to non‑game, non‑owner; owner already passed)
      if (!owner && this.isRateLimited(sender)) {
        return;
      }

      if (plugin.groupOnly && !this.isGroupChat(chatId)) {
        await this.reply(chatId, '⚠️ Este comando solo funciona en grupos.', quoted || message);
        return;
      }

      if (plugin.adminOnly) {
        const allowed = owner || (this.isGroupChat(chatId) && await this.isAdminInGroup(chatId, sender, metadata.senderAliases || []));
        if (!allowed) {
          await this.reply(chatId, '⛔ Solo administradores pueden usar este comando.', quoted || message);
          return;
        }
      }
    }

    const quotedMessage = getQuotedMessage(message);
    const detection = detectMessageContent(message);
    const context = {
      client: this.client,
      message,
      quotedMessage,
      quoted: quoted || message,
      chatId: chatId,
      sender: sender,
      args: parsed.args,
      command: parsed.command,
      prefix: this.config.prefix,
      receivedAt,
      reply: text => { if (!(owner || isPublicCommand)) return Promise.resolve(); return this.reply(chatId, text, quoted || message); },
      sendText: text => { if (!(owner || isPublicCommand)) return Promise.resolve(); return this.sendText(chatId, text, quoted || message); },
      sendTempFile: async (filePath, meta) => {
        if (!(owner || isPublicCommand)) return undefined;
        const result = await this.sendTempFile(chatId, filePath, meta, quoted || message);
        if (['play', 'clip', 'facebook', 'instagram', 'tiktok', 'twitter', 'youtube', 'ytdl', 'ytmp3', 'descargar', 'mediafire'].includes(plugin.name.toLowerCase())) {
          this.profiles.recordDownload([sender, ...senderAliases], {
            pushName: message?.pushName,
            name: message?.pushName
          });
        }
        return result;
      },
      detectContent: () => detectMessageContent(message),
      currentDetection: detection,
      isQuotedMessage: () => isQuotedMessage(message),
      getQuotedMessage: () => quotedMessage,
      getQuotedType: () => getQuotedType(message),
      extractUrls: text => extractUrls(text),
      getContentType: () => getContentType(message),
      getMessageContent: () => getMessageContent(message),
      mediaInfo: getMediaInfo(message),
      isGroup: this.isGroupChat(chatId),
      isOwner: owner,
      isLinked: this.isLinked(sender, senderAliases),
      senderAliases,
      isAdmin: this.isGroupChat(chatId) ? await this.isAdminInGroup(chatId, sender, metadata.senderAliases || []) : false,
      getGroupInfo: () => this.getGroupInfo(chatId),
      handler: this
    };

    logger.command(`Command: ${this.config.prefix}${parsed.command}`, { chatId, sender });
    if (quotedMessage) logger.info('Quoted message detected');
    logger.media(`Content type: ${detection.type}`);

    // start a presence-based processing indicator (no chat messages)
    try {
      const proc = await this.startProcessing(chatId, plugin.name, quoted || message);
      if (proc.already) {
        await this.reply(chatId, '⚠️ Ya hay otra tarea en ejecución en este chat. Espera a que termine.', quoted || message);
        return;
      }
    } catch (e) {
      // ignore presence errors
    }

    try {
      // enforce plugin timeout
      const execPromise = plugin.execute(context);
      const timeoutMs = plugin.timeoutMs
        || (plugin.name.toLowerCase() === 'play'
          ? Math.max(this.config.pluginTimeoutMs || 60000, 240000)
          : (this.config.pluginTimeoutMs || 60000));
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Plugin timeout')), timeoutMs));
      await Promise.race([execPromise, timeoutPromise]);
      logger.success('✓ Response sent');
      // Add random emoji reaction for owner or game
      if (allowReaction) {
        const emojis = ['🖕','🤟','🤘','😈','👿','👹','👺','👻','☠️','💀','👾','🫵','☠️'];
        const reaction = emojis[Math.floor(Math.random() * emojis.length)];
        try {
          await this.client.sendMessage(chatId, { react: { text: reaction, key: context.message.key } });
        } catch (e) {
          // ignore reaction errors
        }
      }
    } catch (error) {
      this.stats.recordError();
      if (String(error?.message || '').includes('Plugin timeout')) {
        logger.warning(`Plugin timeout in ${plugin.name}`);
        await this.reply(chatId, '⚠️ El comando tardó demasiado y fue cancelado. Intenta de nuevo más tarde.', quoted || message);
      } else {
        logger.error(`Plugin error in ${plugin.name}`, { error: error?.message });
        await this.reply(chatId, '⚠️ Ocurrió un error al procesar el comando.', quoted || message);
      }
    } finally {
      // ensure any processing indicator is cleared
      try {
        await this.stopProcessing(chatId);
      } catch (e) {
        // ignore
      }
    }
  }

  startMaintenance() {
    ensureDir(this.config.tempDirectory);
    ensureDir(this.config.sessionDirectory);
    ensureDir(this.config.logDirectory);
    this.tempCleaner.start(5 * 60 * 1000, logger);
  }
}

module.exports = CommandHandler;
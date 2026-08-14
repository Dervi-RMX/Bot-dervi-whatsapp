const fs = require('fs');
const path = require('path');
const {
  getMessageText,
  extractUrls,
  getQuotedMessage,
  isQuotedMessage,
  getQuotedType,
  getMediaInfo,
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
const logger = require('./lib/logger');

class CommandHandler {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.plugins = new Map();
    this.rateMap = new Map();
    this.loading = false;
    this.activeProcessing = new Map(); // track active "processing" messages per chat
    this.groupInfoCache = new Map(); // chatId -> { admins:Set, botIsAdmin:boolean, expires:number }
    this.moderation = new ModerationManager(config);
  }

  async loadPlugins() {
    const pluginsDir = path.join(__dirname, 'plugins');
    ensureDir(pluginsDir);
    const files = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
    const next = new Map();

    for (const file of files) {
      const fullPath = path.join(pluginsDir, file);
      delete require.cache[require.resolve(fullPath)];
      const plugin = require(fullPath);
      if (!plugin || !plugin.name || typeof plugin.execute !== 'function') continue;
      next.set(plugin.name.toLowerCase(), plugin);
      for (const alias of plugin.aliases || []) {
        next.set(String(alias).toLowerCase(), plugin);
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
    const bucket = this.rateMap.get(sender) || [];
    const fresh = bucket.filter(ts => now - ts < windowMs);
    fresh.push(now);
    this.rateMap.set(sender, fresh);
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
    // prevent concurrent processing per chat
    if (this.activeProcessing.has(chatId)) return { already: true };
    // show typing presence if possible
    try {
      if (typeof this.client.sendPresenceUpdate === 'function') {
        await this.client.sendPresenceUpdate('composing', chatId);
      }
    } catch (e) {
      // ignore presence errors
    }
    // no fallback message: keep chat clean and avoid "mensaje en espera"
    this.activeProcessing.set(chatId, { pluginName, startedAt: Date.now(), msgKey: null });
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

    try {
      if (typeof this.client.sendPresenceUpdate === 'function') {
        // pause typing and mark available
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

  isOwner(sender) {
    const owner = normalizeJid(this.config.ownerJid || '');
    if (!owner) return false;
    return normalizeJid(sender) === owner;
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
        .map(p => normalizeJid(p.id))
    );
    const me = normalizeJid(this.client?.user?.id || '');
    const botIsAdmin = admins.has(me);
    const value = { metadata, admins, botIsAdmin, expires: now + 30_000 };
    this.groupInfoCache.set(chatId, value);
    return value;
  }

  async isAdminInGroup(chatId, sender) {
    if (!this.isGroupChat(chatId)) return false;
    const info = await this.getGroupInfo(chatId);
    return info.admins.has(normalizeJid(sender));
  }

  async enforceAntiSpam(message, metadata, parsed) {
    const chatId = metadata.chatId;
    const sender = metadata.sender;
    if (!this.isGroupChat(chatId)) return false;
    if (parsed) return false; // only plain messages, not commands

    const body = normalizeText(getMessageText(message) || '');
    if (!body) return false;

    if (this.isOwner(sender)) return false;
    if (await this.isAdminInGroup(chatId, sender)) return false;

    const result = this.moderation.evaluateMessage(chatId, sender, Date.now());
    if (result.action === 'none') return false;

    if (result.action === 'warn') {
      await this.sendText(
        chatId,
        `⚠️ @${normalizeJid(sender).split('@')[0]} spam detectado (${result.warnings}/${result.antiSpam.maxWarnings}).`,
        message
      );
      return true;
    }

    if (result.action === 'ban') {
      const groupInfo = await this.getGroupInfo(chatId, true);
      if (!groupInfo.botIsAdmin) {
        await this.sendText(chatId, `⚠️ Spam crítico de @${normalizeJid(sender).split('@')[0]} pero no tengo admin para expulsar.`, message);
        return true;
      }
      await this.client.groupParticipantsUpdate(chatId, [normalizeJid(sender)], 'remove');
      await this.sendText(chatId, `🚫 @${normalizeJid(sender).split('@')[0]} expulsado por spam reiterado.`, message);
      return true;
    }

    return false;
  }

  async handleMessage(message, metadata = {}) {
    const chatId = metadata.chatId;
    const sender = metadata.sender;
    const quoted = metadata.quoted || null;
    const receivedAt = metadata.receivedAt || Date.now();
    const body = getMessageText(message).trim();
    const parsed = this.parseCommand(body);

    try {
      await this.enforceAntiSpam(message, metadata, parsed);
    } catch (error) {
      logger.warning('AntiSpam check failed', { error: error?.message || String(error) });
    }

    if (!parsed) {
      if (body.startsWith(this.config.prefix) || normalizeText(body).startsWith(this.config.prefix)) {
        logger.warning('Command text not parsed', { body: normalizeText(body) });
      }
      return;
    }

    if (this.isRateLimited(sender)) {
      await this.reply(chatId, '⚠️ Demasiados comandos seguidos. Intenta de nuevo en unos segundos.', quoted || message);
      return;
    }

    const plugin = this.getPlugin(parsed.command);
    if (!plugin) {
      await this.reply(chatId, `⚠️ Comando no encontrado: ${parsed.command}`, quoted || message);
      return;
    }

    if (plugin.groupOnly && !this.isGroupChat(chatId)) {
      await this.reply(chatId, '⚠️ Este comando solo funciona en grupos.', quoted || message);
      return;
    }

    if (plugin.adminOnly) {
      const allowed = this.isOwner(sender) || (this.isGroupChat(chatId) && await this.isAdminInGroup(chatId, sender));
      if (!allowed) {
        await this.reply(chatId, '⛔ Solo administradores pueden usar este comando.', quoted || message);
        return;
      }
    }

    const quotedMessage = getQuotedMessage(message);
    const detection = detectMessageContent(message);
    const context = {
      client: this.client,
      message,
      quotedMessage,
      quoted: quoted || message,
      chatId,
      sender,
      args: parsed.args,
      command: parsed.command,
      prefix: this.config.prefix,
      receivedAt,
      reply: text => this.reply(chatId, text, quoted || message),
      sendText: text => this.sendText(chatId, text, quoted || message),
      sendTempFile: (filePath, meta) => this.sendTempFile(chatId, filePath, meta, quoted || message),
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
      isOwner: this.isOwner(sender),
      isAdmin: this.isGroupChat(chatId) ? await this.isAdminInGroup(chatId, sender) : false,
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
      const timeoutMs = this.config.pluginTimeoutMs || 60000;
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Plugin timeout')), timeoutMs));
      await Promise.race([execPromise, timeoutPromise]);
      logger.success('✓ Response sent');
    } catch (error) {
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
    cleanupTempFiles(this.config.tempDirectory).catch(() => null);
    setInterval(() => cleanupTempFiles(this.config.tempDirectory).catch(() => null), 5 * 60 * 1000).unref?.();
  }
}

module.exports = CommandHandler;

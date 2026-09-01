const fs = require('fs');
const path = require('path');
const http = require('http');
const qr = require('qrcode-terminal');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  getContentType
} = require('@whiskeysockets/baileys');
const config = require('./config');
const logger = require('./lib/logger');
const CommandHandler = require('./handler');
const { ensureDir, getMessageText, getMediaInfo } = require('./lib/utils');
const { normalizeJid, DEFAULT_WELCOME_MESSAGE } = require('./lib/moderation');
const { inferOutboundKindFromMime, buildOutboundPayload } = require('./lib/media');
const { downloadQuotedMedia } = require('./lib/downloader');

const banner = [
  '╔══════════════════════════════════════╗',
  '║          BOT SANDBOX v1.0            ║',
  '╠══════════════════════════════════════╣',
  '║ WhatsApp Bot                        ║',
  '║ Status: Starting...                 ║',
  '╚══════════════════════════════════════╝'
].join('\n');

let restarting = false;
let httpServerStarted = false;
let currentSocket = null;
let currentSaveCreds = null;
const instanceLockFile = path.join(__dirname, 'bot-sandbox.lock');
const processedCommandsFile = path.join(config.dataDirectory, 'processed-commands.json');
const processedCommandsTtlMs = 7 * 24 * 60 * 60 * 1000;
let noisySignalFilterInstalled = false;

// Variable to hold the auto-detected owner JID
let autoDetectedOwnerJid = null;

function installNoisySignalFilter() {
  if (noisySignalFilterInstalled) return;
  noisySignalFilterInstalled = true;

  const noisyPatterns = [
    'Failed to decrypt message with any known session',
    'Decrypted message with closed session',
    'Bad MAC',
    'MessageCounterError',
    'libsignal\\src\\session_cipher.js',
    'libsignal\\src\\crypto.js',
    'libsignal\\src\\queue_job.js',
    'Closing session: SessionEntry {'
  ];

  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, encoding, callback) => {
    try {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
      if (noisyPatterns.some(pattern => text.includes(pattern))) {
        if (typeof callback === 'function') callback();
        return true;
      }
    } catch {
      // ignore filter errors and fallback to normal write
    }
    return originalStderrWrite(chunk, encoding, callback);
  };

  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    const text = args.map(value => String(value ?? '')).join(' ');
    if (noisyPatterns.some(pattern => text.includes(pattern))) return;
    originalConsoleError(...args);
  };
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireInstanceLock() {
  try {
    if (fs.existsSync(instanceLockFile)) {
      const prev = Number.parseInt(fs.readFileSync(instanceLockFile, 'utf8').trim(), 10);
      if (isProcessRunning(prev)) {
        throw new Error(`BOT SANDBOX ya está ejecutándose (PID ${prev}).`);
      }
      fs.unlinkSync(instanceLockFile);
    }
    fs.writeFileSync(instanceLockFile, String(process.pid), 'utf8');
  } catch (error) {
    throw error;
  }
}

function releaseInstanceLock() {
  try {
    if (!fs.existsSync(instanceLockFile)) return;
    const owner = Number.parseInt(fs.readFileSync(instanceLockFile, 'utf8').trim(), 10);
    if (owner === process.pid) fs.unlinkSync(instanceLockFile);
  } catch {
    // ignore cleanup errors
  }
}

function loadProcessedCommandIds(now = Date.now()) {
  try {
    if (!fs.existsSync(processedCommandsFile)) return new Map();
    const raw = JSON.parse(fs.readFileSync(processedCommandsFile, 'utf8'));
    const source = raw && typeof raw === 'object' && raw.messages && typeof raw.messages === 'object'
      ? raw.messages
      : raw;
    const entries = source && typeof source === 'object' ? Object.entries(source) : [];
    const result = new Map();
    for (const [id, value] of entries) {
      const timestamp = Number(value);
      if (!id || !Number.isFinite(timestamp)) continue;
      if (now - timestamp >= 0 && now - timestamp <= processedCommandsTtlMs) {
        result.set(id, timestamp);
      }
    }
    return result;
  } catch (error) {
    logger.warning('Could not load processed command ledger', {
      file: processedCommandsFile,
      error: error?.message || String(error)
    });
    return new Map();
  }
}

function saveProcessedCommandIds(processedIds) {
  const payload = JSON.stringify(Object.fromEntries(processedIds.entries()));
  const temporaryFile = `${processedCommandsFile}.${process.pid}.tmp`;
  try {
    ensureDir(config.dataDirectory);
    fs.writeFileSync(temporaryFile, payload, 'utf8');
    try {
      fs.renameSync(temporaryFile, processedCommandsFile);
    } catch (renameError) {
      // Windows can reject replacing an existing file; keep the ledger durable.
      fs.writeFileSync(processedCommandsFile, payload, 'utf8');
      fs.rmSync(temporaryFile, { force: true });
    }
  } catch (error) {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // ignore cleanup errors
    }
    logger.warning('Could not save processed command ledger', {
      file: processedCommandsFile,
      error: error?.message || String(error)
    });
  }
}

function getMessageTimestampSeconds(message) {
  const raw = message?.messageTimestamp;
  const candidates = [
    typeof raw?.toNumber === 'function' ? raw.toNumber() : null,
    raw && typeof raw === 'object' ? raw.low : null,
    raw && typeof raw === 'object' ? raw.value : null,
    raw && typeof raw === 'object' ? raw.$numberLong : null,
    raw
  ];

  for (const candidate of candidates) {
    const timestamp = Number(candidate);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    return timestamp > 10 ** 12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
  }
  return null;
}

process.on('uncaughtException', error => {
  const message = String(error?.message || '');
  if (/Connection Closed|Precondition Required/i.test(message)) {
    logger.warning('Socket reconnect in progress', { error: message });
    return;
  }
  logger.error('Uncaught exception', { error: message });
});

process.on('unhandledRejection', reason => {
  const message = String(reason?.message || reason || '');
  if (/Connection Closed|Precondition Required/i.test(message)) {
    logger.warning('Socket reconnect in progress', { error: message });
    return;
  }
  logger.error('Unhandled rejection', { error: message });
});

async function startBot() {
  const startedAtSeconds = Math.floor(Date.now() / 1000);
  installNoisySignalFilter();
  ensureDir(config.sessionDirectory);
  ensureDir(config.tempDirectory);
  ensureDir(config.logDirectory);
  ensureDir(config.dataDirectory);
  logger.ensureLogFile(config.logDirectory);
  console.log(banner);
  console.log('\nIniciando WhatsApp...\n');
  // Close existing socket if any
  if (currentSocket) {
    try {
      if (typeof currentSocket.end === 'function') {
        await currentSocket.end();
      } else if (typeof currentSocket.close === 'function') {
        await currentSocket.close();
      }
    } catch (err) {
      logger.warning('Error closing previous WhatsApp socket', { error: err.message });
    }
    // Remove previous creds.update listener to avoid duplicates
    if (currentSaveCreds && typeof currentSocket.ev.off === 'function') {
      try {
        currentSocket.ev.off('creds.update', currentSaveCreds);
      } catch (err) {
        logger.warning('Error removing creds.update listener', { error: err.message });
      }
    }
    currentSocket = null;
    currentSaveCreds = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDirectory);
  currentSaveCreds = saveCreds;
  const { version } = await fetchLatestBaileysVersion();

  // Auto-detect owner if not set in config
  let effectiveOwnerJid = config.ownerJid;
  if (!effectiveOwnerJid && state.creds.me) {
    // Use the authenticated user's JID as the owner if not explicitly set
    const me = state.creds.me;
    effectiveOwnerJid = (me && me.id) || me || '';
    // Ensure we have a string JID
    if (typeof effectiveOwnerJid !== 'string') {
      effectiveOwnerJid = String(effectiveOwnerJid);
    }
    autoDetectedOwnerJid = effectiveOwnerJid;
    logger.info('Owner auto-detected from credentials', { ownerJid: effectiveOwnerJid });
    // Update config so that handler sees the owner
    config.ownerJid = effectiveOwnerJid;
  } else if (!effectiveOwnerJid) {
    logger.warning('No owner JID configured and could not auto-detect from credentials');
  }

  const socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    browser: ['BOT SANDBOX', 'Chrome', '1.0.0']
  });

  // Keep reference to current socket for HTTP health checks
  currentSocket = socket;

  const sentMessageIds = new Set();
  const processedIncoming = new Map(); // id -> timestamp
  const processedCommandIds = loadProcessedCommandIds();
  const recentMessages = new Map(); // cache key -> snapshot for anti-delete/edit
  const recentEditEvents = new Map();
  const originalSendMessage = socket.sendMessage.bind(socket);
  socket.sendMessage = async (...args) => {
    const result = await originalSendMessage(...args);
    const id = result?.key?.id;
    if (id) sentMessageIds.add(id);
    return result;
  };

  // keep processedIncoming as a short-lived cache to avoid double-processing
  function markProcessed(id) {
    if (!id) return;
    processedIncoming.set(id, Date.now());
    // keep size reasonable
    if (processedIncoming.size > 2000) {
      // remove oldest
      const keys = Array.from(processedIncoming.keys()).slice(0, 500);
      for (const k of keys) processedIncoming.delete(k);
    }
  }

  function isProcessed(id) {
    if (!id) return false;
    return processedIncoming.has(id);
  }

  function markCommandProcessed(id) {
    if (!id) return;
    const now = Date.now();
    processedCommandIds.set(id, now);
    for (const [messageId, timestamp] of processedCommandIds.entries()) {
      if (now - timestamp > processedCommandsTtlMs) processedCommandIds.delete(messageId);
    }
    saveProcessedCommandIds(processedCommandIds);
  }

  function isCommandProcessed(id) {
    if (!id) return false;
    const timestamp = processedCommandIds.get(id);
    if (!timestamp) return false;
    if (Date.now() - timestamp > processedCommandsTtlMs) {
      processedCommandIds.delete(id);
      return false;
    }
    return true;
  }

  function getMessageCacheKeys(key = {}) {
    const remoteJid = key.remoteJid || '';
    const participant = key.participant || '';
    const id = key.id || '';
    if (!id) return [];
    // Optimized: use Set directly to avoid array creation and conversion
    const keysSet = new Set();
    keysSet.add(`${remoteJid}|${participant}|${id}`);
    keysSet.add(`${remoteJid}||${id}`);
    keysSet.add(`|${participant}|${id}`);
    keysSet.add(`||${id}`);
    return [...keysSet];
  }

  function cacheIncomingMessage(msg) {
    if (!config.antiDeleteEnabled && !config.antiEditEnabled) return;
    if (!msg?.message) return;
    if (msg.message.protocolMessage) return; // deletion/control message

    const cacheKeys = getMessageCacheKeys(msg.key || {});
    if (!cacheKeys.length) return;
    // Keep the first version so an edit can still report the original text.
    if (cacheKeys.some(key => recentMessages.has(key))) return;

    const chatId = msg.key?.remoteJid || '';
    const senderPn = msg.key?.participantPn || msg.key?.senderPn || '';
    const sender = senderPn
      || msg.key?.participant
      || msg.key?.participantLid
      || msg.key?.senderPn
      || chatId
      || '';
    const content = msg.message || {};
    const contentType = getContentType(content) || 'unknown';
    const text = getMessageText(msg) || '';

    const snapshot = {
      chatId,
      chatPn: /@s\.whatsapp\.net$/i.test(chatId) ? chatId : senderPn,
      sender,
      senderPn,
      senderName: msg.pushName || msg.verifiedBizName || '',
      contentType,
      text,
      message: msg.message,
      timestamp: Date.now()
    };

    for (const key of cacheKeys) recentMessages.set(key, snapshot);

    if (recentMessages.size > 4000) {
      const toDelete = Array.from(recentMessages.keys()).slice(0, 800);
      for (const key of toDelete) recentMessages.delete(key);
    }
  }

  function findDeletedSnapshot(protocolKey = {}, currentMsg = {}) {
    const keyFromProtocol = {
      remoteJid: protocolKey.remoteJid || currentMsg.key?.remoteJid || '',
      participant: protocolKey.participant || currentMsg.key?.participant || '',
      id: protocolKey.id || ''
    };

    for (const k of getMessageCacheKeys(keyFromProtocol)) {
      if (recentMessages.has(k)) return recentMessages.get(k);
    }
    return null;
  }

  function getPhoneNumber(jid) {
    const value = String(jid || '').trim();
    const at = value.indexOf('@');
    if (at === -1) return /^\d{7,15}$/.test(value) ? `+${value}` : '';
    const domain = value.slice(at + 1).toLowerCase();
    const number = value.slice(0, at).split(':')[0];
    if (domain !== 's.whatsapp.net' || !/^\d{7,15}$/.test(number)) return '';
    return `+${number}`;
  }

  async function getDeletedChatLabel(snapshot) {
    const chatId = String(snapshot?.chatId || '');
    if (chatId.endsWith('@g.us')) {
      try {
        const metadata = await socket.groupMetadata(chatId);
        if (metadata?.subject) return `Grupo: ${metadata.subject}`;
      } catch {
        // Keep a generic group label when metadata is unavailable.
      }
      return 'Grupo de WhatsApp';
    }

    const name = String(snapshot?.senderName || '').trim();
    const phone = getPhoneNumber(snapshot?.chatPn || snapshot?.senderPn || snapshot?.sender);
    if (name && phone) return `Chat privado: ${name} (${phone})`;
    if (name) return `Chat privado: ${name}`;
    if (phone) return `Chat privado: ${phone}`;
    return 'Chat privado de WhatsApp';
  }

  async function formatDeletedNotice(snapshot) {
    const typeMap = {
      conversation: 'texto',
      extendedTextMessage: 'texto',
      imageMessage: 'imagen',
      videoMessage: 'video',
      audioMessage: 'audio',
      documentMessage: 'documento',
      stickerMessage: 'sticker'
    };
    const kind = typeMap[snapshot.contentType] || snapshot.contentType || 'mensaje';
    const body = snapshot.text ? snapshot.text.slice(0, 1200) : '[sin texto/caption]';
    const senderName = String(snapshot.senderName || '').trim();
    const senderPhone = getPhoneNumber(snapshot.senderPn || snapshot.sender);
    const senderLabel = senderName && senderPhone
      ? `${senderName} (${senderPhone})`
      : senderName || senderPhone || 'Usuario de WhatsApp';
    const chatLabel = await getDeletedChatLabel(snapshot);

    return [
      '🕵️ *ANTI-DELETE*',
      `👤 Lo envió: ${senderLabel}`,
      `💬 Chat: ${chatLabel}`,
      `Tipo: ${kind}`,
      '',
      body
    ].join('\n');
  }

  function getMonitoringTarget(sourceChatId, fallbackToSource = true) {
    const target = normalizeJid(
      config.antiDeleteTargetJid
      || config.ownerJid  // Use the configured (or auto-detected) owner
      || socket.user?.id
      || socket.user?.lid
    );
    return target || (fallbackToSource ? sourceChatId : '');
  }

  function extractEditedContent(update) {
    const edited = update?.update?.message?.editedMessage;
    if (!edited || typeof edited !== 'object') return null;
    if (edited.message && typeof edited.message === 'object') return edited.message;
    return edited;
  }

  async function formatEditedNotice(snapshot, editedContent) {
    const typeMap = {
      conversation: 'texto',
      extendedTextMessage: 'texto',
      imageMessage: 'imagen',
      videoMessage: 'video',
      audioMessage: 'audio',
      documentMessage: 'documento',
      stickerMessage: 'sticker'
    };
    const editedWrapper = { message: editedContent };
    const editedType = getContentType(editedWrapper) || snapshot.contentType || 'mensaje';
    const kind = typeMap[editedType] || editedType;
    const originalText = snapshot.text ? snapshot.text.slice(0, 1200) : '[sin texto/caption]';
    const editedText = getMessageText(editedWrapper).slice(0, 1200) || '[sin texto/caption]';
    const senderName = String(snapshot.senderName || '').trim();
    const senderPhone = getPhoneNumber(snapshot.senderPn || snapshot.sender);
    const senderLabel = senderName && senderPhone
      ? `${senderName} (${senderPhone})`
      : senderName || senderPhone || 'Usuario de WhatsApp';
    const chatLabel = await getDeletedChatLabel(snapshot);

    return [
      '✏️ *ANTI-EDIT*',
      `👤 Lo envió: ${senderLabel}`,
      `💬 Chat: ${chatLabel}`,
      `Tipo: ${kind}`,
      '',
      '*Mensaje original:*',
      originalText,
      '',
      '*Mensaje editado:*',
      editedText
    ].join('\n');
  }

  async function replayEditedMessage(snapshot, editedContent) {
    const targetChatId = getMonitoringTarget(snapshot?.chatId, false);
    if (!targetChatId) {
      logger.warning('Anti-edit notice skipped: no private target configured');
      return false;
    }
    await socket.sendMessage(targetChatId, {
      text: await formatEditedNotice(snapshot, editedContent)
    });
    return true;
  }

  async function processEditedMessage(originalKey = {}, editedContent, currentMsg = {}) {
    if (!config.antiEditEnabled || !editedContent) return false;
    const snapshot = findDeletedSnapshot(originalKey, currentMsg);
    if (!snapshot) {
      logger.info('Edited message original not found in cache', {
        chatId: originalKey.remoteJid || currentMsg.key?.remoteJid,
        messageId: originalKey.id
      });
      return false;
    }

    const editedText = getMessageText({ message: editedContent }) || '';
    const eventKey = `${originalKey.remoteJid || ''}|${originalKey.participant || ''}|${originalKey.id || ''}|${editedText}`;
    const now = Date.now();
    const previous = recentEditEvents.get(eventKey) || 0;
    if (now - previous < 10_000) return false;
    recentEditEvents.set(eventKey, now);
    for (const [key, timestamp] of recentEditEvents.entries()) {
      if (now - timestamp > 60_000) recentEditEvents.delete(key);
    }

    const sent = await replayEditedMessage(snapshot, editedContent);
    if (sent) {
      logger.info('Anti-edit notice sent', {
        chatId: snapshot.chatId,
        messageId: originalKey.id,
        target: getMonitoringTarget(snapshot.chatId, false)
      });
    }
    return sent;
  }

  async function replayDeletedMessage(snapshot) {
    const sourceChatId = snapshot?.chatId;
    if (!sourceChatId) return;
    const targetChatId = getMonitoringTarget(sourceChatId);

    const mediaTypes = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']);
    const isMedia = mediaTypes.has(snapshot.contentType);

    if (!isMedia) {
      await socket.sendMessage(targetChatId, { text: await formatDeletedNotice(snapshot) });
      return;
    }

    try {
      const wrapped = { message: snapshot.message };
      const filePath = await downloadQuotedMedia(wrapped, config.tempDirectory);
      const info = getMediaInfo(wrapped) || {};
      const mimeType = info.mimetype || '';
      const kind = inferOutboundKindFromMime(mimeType);

      // Check if the original media was view-once
      const originalMedia = snapshot.message[snapshot.contentType] || {};
      const isViewOnce = originalMedia.viewOnce === true;

      const payload = buildOutboundPayload(filePath, {
        fileName: info.fileName || 'archivo',
        mimeType,
        kind,
        caption: await formatDeletedNotice(snapshot),
        ptt: snapshot.contentType === 'audioMessage',
        viewOnce: isViewOnce
      });

      await socket.sendMessage(targetChatId, payload);
      await fs.promises.unlink(filePath).catch(() => null);
    } catch (error) {
      logger.warning('Anti-delete media replay failed', { error: String(error?.message || error) });
      await socket.sendMessage(targetChatId, { text: await formatDeletedNotice(snapshot) });
    }
  }

  // periodic cleanup - optimized with chained operations
  setInterval(() => {
    const cutoff = Date.now() - 1000 * 60 * 10; // 10 min
    for (const [k, t] of processedIncoming.entries()) {
      if (t < cutoff) processedIncoming.delete(k);
    }

    const msgCutoff = Date.now() - 1000 * 60 * 30; // 30 min
    for (const [k, snap] of recentMessages.entries()) {
      if (!snap?.timestamp || snap.timestamp < msgCutoff) recentMessages.delete(k);
    }
  }, 1000 * 60 * 5).unref?.();

  const handler = new CommandHandler(socket, config);
  await handler.loadPlugins();
  handler.startMaintenance();

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', update => {
    if (update.qr) {
      console.log('Escanea el QR con WhatsApp.\n');
      qr.generate(update.qr, { small: true });
      console.log('\nEsperando conexión...\n');
    }

    if (update.connection === 'open') {
      logger.success('✓ WhatsApp conectado correctamente.');
      console.log('\nBOT SANDBOX ONLINE');
      console.log(`Prefix: ${config.prefix}`);

      // Show owner information
      if (autoDetectedOwnerJid) {
        console.log(`👤 Owner auto-detected: ${autoDetectedOwnerJid}`);
        console.log(`   (Para fijar manualmente, establece BOT_OWNER_JID en .env)`);
      } else if (config.ownerJid) {
        console.log(`👤 Owner configurado: ${config.ownerJid}`);
      }

      console.log('Waiting for messages...');
    }

    if (update.connection === 'close') {
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warning('Conexión cerrada', { statusCode, reconnect: shouldReconnect });
      if (shouldReconnect && !restarting) {
        restarting = true;
        setTimeout(() => {
          startBot()
            .catch(err => logger.error('Error reiniciando bot', { error: err.message }))
            .finally(() => {
              restarting = false;
            });
        }, 2000);
      } else {
        logger.error('Sesión cerrada. Vuelve a vincular WhatsApp.');
      }
    }
  });

  const recentWelcomeEvents = new Map();
  const recentGoodbyeEvents = new Map();

  function renderWelcomeMessage(template, participantJids) {
    const mentions = participantJids.map(jid => `@${String(jid).split('@')[0]}`);
    const mentionText = mentions.join(', ');
    const source = String(template || DEFAULT_WELCOME_MESSAGE);
    return source.includes('{user}')
      ? source.replace(/\{user\}/gi, mentionText)
      : `${source}\n\n${mentionText}`;
  }

  function renderGoodbyeMessage(template, participantJids) {
    const mentions = participantJids.map(jid => `@${String(jid).split('@')[0]}`);
    const mentionText = mentions.join(', ');
    const source = String(template || DEFAULT_WELCOME_MESSAGE);
    return source.includes('{user}')
      ? source.replace(/\{user\}/gi, mentionText)
      : `${source}\n\n${mentionText}`;
  }

  socket.ev.on('group-participants.update', async update => {
    try {
      if (!update || update.action !== 'add' || !update.id) return;
      const participants = [...new Set(
        (Array.isArray(update.participants) ? update.participants : [])
          .map(participant => normalizeJid(participant))
          .filter(participant => participant && !participant.endsWith('@g.us'))
      )];
      if (!participants.length) return;

      const eventKey = `${update.id}|${update.action}|${participants.join(',')}`;
      const now = Date.now();
      const previous = recentWelcomeEvents.get(eventKey) || 0;
      if (now - previous < 10_000) return;
      recentWelcomeEvents.set(eventKey, now);
      for (const [key, timestamp] of recentWelcomeEvents.entries()) {
        if (now - timestamp > 60_000) recentWelcomeEvents.delete(key);
      }

      const settings = handler.moderation.getWelcome(update.id);
      if (!settings.enabled) return;

      const text = renderWelcomeMessage(settings.message, participants);
      await socket.sendMessage(update.id, { text, mentions: participants });
      logger.success('Welcome message sent', { chatId: update.id, participants });
    } catch (error) {
      logger.warning('Welcome message failed', { error: String(error?.message || error) });
    }
  });

  socket.ev.on('group-participants.update', async update => {
    try {
      if (!update || update.action !== 'remove' || !update.id) return;
      const participants = [...new Set(
        (Array.isArray(update.participants) ? update.participants : [])
          .map(participant => normalizeJid(participant))
          .filter(participant => participant && !participant.endsWith('@g.us'))
      )];
      if (!participants.length) return;

      const eventKey = `${update.id}|${update.action}|${participants.join(',')}`;
      const now = Date.now();
      const previous = recentGoodbyeEvents.get(eventKey) || 0;
      if (now - previous < 10_000) return;
      recentGoodbyeEvents.set(eventKey, now);
      for (const [key, timestamp] of recentGoodbyeEvents.entries()) {
        if (now - timestamp > 60_000) recentGoodbyeEvents.delete(key);
      }

      const settings = handler.moderation.getGoodbye(update.id);
      if (!settings.enabled) return;

      const text = renderGoodbyeMessage(settings.message, participants);
      await socket.sendMessage(update.id, { text, mentions: participants });
      logger.success('Goodbye message sent', { chatId: update.id, participants });
    } catch (error) {
      logger.warning('Goodbye message failed', { error: String(error?.message || error) });
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !messages?.length) return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;

        // WhatsApp may redeliver queued messages after a restart. Never
        // execute commands that were created before this bot instance began.
        const messageTimestamp = getMessageTimestampSeconds(msg);
        if (!messageTimestamp) {
          logger.warning('Ignoring message without a valid timestamp', {
            id: msg.key?.id,
            fromMe: Boolean(msg.key?.fromMe),
            upsertType: type
          });
          continue;
        }
        if (messageTimestamp <= startedAtSeconds) {
          logger.info('Ignoring stale message after restart', {
            id: msg.key?.id,
            messageTimestamp,
            startedAtSeconds
          });
          continue;
        }

        // dedupe incoming message IDs (some networks deliver duplicates)
        const incomingId = msg.key?.id;
        const messageText = getMessageText(msg) || '';
        const isCommand = String(messageText).trim().startsWith(config.prefix);
        if (isCommand && incomingId && isCommandProcessed(incomingId)) {
          logger.info('Ignoring previously processed command after reconnect', {
            id: incomingId,
            messageTimestamp,
            fromMe: Boolean(msg.key?.fromMe)
          });
          continue;
        }
        if (incomingId && isProcessed(incomingId)) continue;
        if (incomingId) markProcessed(incomingId);

        if (msg.key?.id && sentMessageIds.has(msg.key.id)) {
          // message was sent by this bot instance; ignore
          sentMessageIds.delete(msg.key.id);
          continue;
        }
        if (isCommand && incomingId) markCommandProcessed(incomingId);

        const chatId = msg.key.remoteJid;
        if (!chatId || chatId === 'status@broadcast') continue;
        // Messages sent from the connected account can carry the recipient's
        // LID in remoteJid. Treat them as owner commands instead of using the
        // recipient as the sender.
        // For incoming messages, prefer Baileys' phone-number JID when the
        // account is represented by a WhatsApp LID (@lid).
        const senderAliases = [...new Set(
          (msg.key.fromMe
            ? [socket.user?.id, socket.user?.lid, config.ownerJid]  // Use configured owner (now set)
            : [
                msg.key.participantPn,
                msg.key.senderPn,
                msg.key.participant,
                msg.key.participantLid,
                msg.key.senderPn,
                ...(!String(chatId).endsWith('@g.us') ? [chatId] : [])
              ]
          ).filter(Boolean)
        )];
        const sender = msg.key.fromMe
          ? (socket.user?.id || config.ownerJid || socket.user?.lid || chatId)
          : (msg.key.participantPn
            || msg.key.senderPn
            || msg.key.participant
            || msg.key.participantLid
            || msg.key.senderPn
            || chatId);

        const editedContent = msg.message?.protocolMessage?.editedMessage;
        if (config.antiEditEnabled && editedContent && msg.message?.protocolMessage?.key?.id) {
          await processEditedMessage(msg.message.protocolMessage.key, editedContent, msg);
          continue;
        }

        if (config.antiDeleteEnabled && msg.message?.protocolMessage?.key?.id) {
          const snapshot = findDeletedSnapshot(msg.message.protocolMessage.key, msg);
          if (snapshot && snapshot.chatId) {
            await replayDeletedMessage(snapshot);
            logger.info('Anti-delete replay sent', { chatId: snapshot.chatId, sender: snapshot.sender });
          }
          continue;
        }

        cacheIncomingMessage(msg);

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant || null;
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
        const receivedAt = Date.now();
        // only log incoming messages when they look like commands (start with prefix)
        try {
          const text = getMessageText(msg) || '';
          if (String(text).trim().startsWith(config.prefix)) {
            const trimmed = String(text).trim();
            const command = trimmed.slice(config.prefix.length).split(/\s+/)[0].toLowerCase();
            const sensitiveCommands = new Set(['vincular', 'link', 'unir']);
            const loggedText = sensitiveCommands.has(command)
              ? `${config.prefix}${command} [código oculto]`
              : trimmed.slice(0, 200);
            logger.info('← Command received', {
              chatId,
              sender,
              fromMe: Boolean(msg.key?.fromMe),
              messageId: incomingId,
              messageTimestamp,
              upsertType: type,
              text: loggedText
            });
          }
        } catch (e) {
          // ignore logging errors
        }
        await handler.handleMessage(msg, {
          chatId,
          sender,
          senderAliases,
          receivedAt,
          quoted: quotedMessage ? msg : null
        });
      } catch (error) {
        logger.error('Error processing message', { error: error.message });
      }
    }
  });

  socket.ev.on('messages.update', async updates => {
    for (const update of updates || []) {
      try {
        const editedContent = extractEditedContent(update);
        if (config.antiEditEnabled && editedContent) {
          await processEditedMessage(update.key || {}, editedContent, update);
          continue;
        }

        if (update.update?.status) logger.info('Message status updated');
      } catch (error) {
        logger.warning('Anti-edit processing failed', { error: String(error?.message || error) });
      }
    }
  });

  // Start HTTP server for Render health checks (only once)
  if (!httpServerStarted) {
    const port = process.env.PORT || 10000;
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        // Maintain original response
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot WhatsApp funcionando');
      } else if (req.method === 'GET' && req.url === '/health') {
        // Health check endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'online',
          service: 'BOT SANDBOX WhatsApp Bot',
          timestamp: new Date().toISOString(),
          whatsappConnected: !!currentSocket?.user?.id
        }));
      } else {
        // Not found
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(port, '0.0.0.0', () => {
      logger.info(`HTTP server listening on port ${port}`);
    });

    httpServerStarted = true;
  }

  return { socket, handler };
}

if (require.main === module) {
  try {
    acquireInstanceLock();
  } catch (error) {
    logger.error('No se pudo iniciar BOT SANDBOX', { error: error.message });
    process.exit(1);
  }
  process.on('exit', releaseInstanceLock);
  process.on('SIGINT', () => {
    releaseInstanceLock();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    releaseInstanceLock();
    process.exit(0);
  });
  startBot().catch(error => {
    logger.error('Fatal error starting BOT SANDBOX', { error: error.message });
    releaseInstanceLock();
    process.exitCode = 1;
  });
}

module.exports = { startBot };
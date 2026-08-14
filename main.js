const fs = require('fs');
const path = require('path');
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
const instanceLockFile = path.join(__dirname, 'bot-sandbox.lock');
let noisySignalFilterInstalled = false;

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
  installNoisySignalFilter();
  ensureDir(config.sessionDirectory);
  ensureDir(config.tempDirectory);
  ensureDir(config.logDirectory);
  logger.ensureLogFile(config.logDirectory);
  console.log(banner);
  console.log('\nIniciando WhatsApp...\n');

  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDirectory);
  const { version } = await fetchLatestBaileysVersion();

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

  const sentMessageIds = new Set();
  const processedIncoming = new Map(); // id -> timestamp
  const recentMessages = new Map(); // cache key -> snapshot for anti-delete
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

  function getMessageCacheKeys(key = {}) {
    const remoteJid = key.remoteJid || '';
    const participant = key.participant || '';
    const id = key.id || '';
    if (!id) return [];
    const keys = [
      `${remoteJid}|${participant}|${id}`,
      `${remoteJid}||${id}`,
      `|${participant}|${id}`,
      `||${id}`
    ];
    return [...new Set(keys)];
  }

  function cacheIncomingMessage(msg) {
    if (!config.antiDeleteEnabled) return;
    if (!msg?.message) return;
    if (msg.message.protocolMessage) return; // deletion/control message
    if (msg.key?.fromMe) return;

    const chatId = msg.key?.remoteJid || '';
    const sender = msg.key?.participant || chatId || '';
    const content = msg.message || {};
    const contentType = getContentType(content) || 'unknown';
    const text = getMessageText(msg) || '';

    const snapshot = {
      chatId,
      sender,
      contentType,
      text,
      message: msg.message,
      timestamp: Date.now()
    };

    for (const k of getMessageCacheKeys(msg.key || {})) {
      recentMessages.set(k, snapshot);
    }

    if (recentMessages.size > 4000) {
      const toDelete = Array.from(recentMessages.keys()).slice(0, 800);
      for (const k of toDelete) recentMessages.delete(k);
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

  function formatDeletedNotice(snapshot) {
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
    return [
      '🕵️ *ANTI-DELETE*',
      `Tipo: ${kind}`,
      `Origen chat: ${snapshot.chatId}`,
      `Remitente: ${snapshot.sender}`,
      '',
      body
    ].join('\n');
  }

  async function replayDeletedMessage(snapshot) {
    const sourceChatId = snapshot?.chatId;
    if (!sourceChatId) return;
    const targetChatId = config.antiDeleteTargetJid || sourceChatId;

    const mediaTypes = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']);
    const isMedia = mediaTypes.has(snapshot.contentType);

    if (!isMedia) {
      await socket.sendMessage(targetChatId, { text: formatDeletedNotice(snapshot) });
      return;
    }

    try {
      const wrapped = { message: snapshot.message };
      const filePath = await downloadQuotedMedia(wrapped, config.tempDirectory);
      const info = getMediaInfo(wrapped) || {};
      const mimeType = info.mimetype || '';
      const kind = inferOutboundKindFromMime(mimeType);
      const payload = buildOutboundPayload(filePath, {
        fileName: info.fileName || 'archivo',
        mimeType,
        kind,
        caption: `🕵️ ANTI-DELETE\nTipo: ${kind}\nOrigen chat: ${snapshot.chatId}\nRemitente: ${snapshot.sender}`,
        ptt: snapshot.contentType === 'audioMessage'
      });

      await socket.sendMessage(targetChatId, payload);
      await fs.promises.unlink(filePath).catch(() => null);
    } catch (error) {
      logger.warning('Anti-delete media replay failed', { error: String(error?.message || error) });
      await socket.sendMessage(targetChatId, { text: formatDeletedNotice(snapshot) });
    }
  }

  // periodic cleanup
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

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !messages?.length) return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        // dedupe incoming message IDs (some networks deliver duplicates)
        const incomingId = msg.key?.id;
        if (incomingId && isProcessed(incomingId)) continue;
        if (incomingId) markProcessed(incomingId);

        if (msg.key?.id && sentMessageIds.has(msg.key.id)) {
          // message was sent by this bot instance; ignore
          sentMessageIds.delete(msg.key.id);
          continue;
        }

        const chatId = msg.key.remoteJid;
        if (!chatId || chatId === 'status@broadcast') continue;
        const sender = msg.key.participant || chatId;

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
            logger.info('← Command received', { chatId, sender, text: (text || '').slice(0, 200) });
          }
        } catch (e) {
          // ignore logging errors
        }
        await handler.handleMessage(msg, {
          chatId,
          sender,
          receivedAt,
          quoted: quotedMessage ? msg : null
        });
      } catch (error) {
        logger.error('Error processing message', { error: error.message });
      }
    }
  });

  socket.ev.on('messages.update', updates => {
    for (const update of updates || []) {
      if (!update.update?.status) continue;
      logger.info('Message status updated');
    }
  });

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

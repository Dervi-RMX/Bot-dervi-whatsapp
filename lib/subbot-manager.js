const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qr = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const CommandHandler = require('../handler');
const { normalizeJid } = require('./moderation');
const { createDataStore } = require('./data-store');

class SubbotManager {
  constructor(mainSocket, config) {
    this.mainSocket = mainSocket;
    this.config = config;
    this.store = createDataStore(config.dataDirectory);
    this.registryPath = this.store.path('subbots.json');
    this.records = new Map();
    this.runtimes = new Map();
    this.starting = new Map();
    this.pendingDeletes = new Map();
    this.load();
  }

  load() {
    try {
      const data = this.store.read('subbots.json', []);
      for (const record of Array.isArray(data) ? data : []) {
        if (record?.id) this.records.set(record.id, record);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  save() {
    this.store.write('subbots.json', [...this.records.values()]);
  }

  nextId() {
    let number = 1;
    while (this.records.has(`SUB-${String(number).padStart(3, '0')}`)) number += 1;
    return `SUB-${String(number).padStart(3, '0')}`;
  }

  create() {
    const id = this.nextId();
    const record = {
      id,
      status: 'OFFLINE',
      jid: '',
      createdAt: new Date().toISOString()
    };
    this.records.set(id, record);
    this.save();
    return record;
  }

  get(id) {
    return this.records.get(String(id || '').toUpperCase()) || null;
  }

  list() {
    return [...this.records.values()];
  }

  update(id, patch) {
    const record = this.get(id);
    if (!record) return null;
    Object.assign(record, patch);
    this.save();
    return record;
  }

  buildConfig(id) {
    return {
      ...this.config,
      isSubbot: true,
      ownerJid: normalizeJid(this.config.ownerJid || ''),
      ownerLid: '',
      sessionDirectory: path.join(this.config.sessionDirectory, id),
      dataDirectory: path.join(this.config.dataDirectory, id),
      tempDirectory: path.join(this.config.tempDirectory, id),
      logDirectory: path.join(this.config.logDirectory, id)
    };
  }

  async start(id, options = {}) {
    const normalizedId = String(id || '').toUpperCase();
    if (this.runtimes.has(normalizedId)) return this.runtimes.get(normalizedId);
    if (this.starting.has(normalizedId)) return this.starting.get(normalizedId);
    const promise = this.startInternal(normalizedId, options);
    this.starting.set(normalizedId, promise);
    try {
      return await promise;
    } finally {
      this.starting.delete(normalizedId);
    }
  }

  async startInternal(id, options = {}) {
    const record = this.get(id);
    if (!record) throw new Error(`Subbot inexistente: ${id}`);
    if (this.runtimes.has(record.id)) return this.runtimes.get(record.id);

    const subConfig = this.buildConfig(record.id);
    for (const directory of [
      subConfig.sessionDirectory,
      subConfig.dataDirectory,
      subConfig.tempDirectory,
      subConfig.logDirectory
    ]) fs.mkdirSync(directory, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(subConfig.sessionDirectory);
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['BOT SUBBOT', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: true
    });
    const handler = new CommandHandler(socket, subConfig);
    await handler.loadPlugins();
    handler.subbots = this;

    const runtime = {
      id: record.id,
      socket,
      handler,
      saveCreds,
      registered: Boolean(state.creds.registered),
      qrTargetChatId: normalizeJid(options.targetChatId || ''),
      stopping: false,
      reconnectTimer: null
    };
    this.runtimes.set(record.id, runtime);
    this.update(record.id, { status: 'CONECTANDO' });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages || []) this.dispatch(runtime, message).catch(error => {
        console.warn(`[${record.id}] Error procesando mensaje:`, error.message);
      });
    });
    socket.ev.on('connection.update', update => {
      if (update.qr) this.sendQr(record.id, update.qr, runtime.qrTargetChatId).catch(() => null);
      if (update.connection === 'open') {
        const jid = normalizeJid(socket.user?.id || socket.user?.lid || '');
        this.update(record.id, { status: 'ONLINE', jid });
      }
      if (update.connection === 'close') {
        this.runtimes.delete(record.id);
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = !runtime.stopping && code !== DisconnectReason.loggedOut;
        this.update(record.id, { status: shouldReconnect ? 'CONECTANDO' : 'OFFLINE' });
        if (shouldReconnect) {
          runtime.reconnectTimer = setTimeout(() => {
            this.start(record.id).catch(error => {
              this.update(record.id, { status: 'OFFLINE', error: error.message });
            });
          }, 3000);
        }
      }
    });

    return runtime;
  }

  async requestPairingCode(id, phone, targetChatId) {
    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.slice(2);
    if (!/^\d{8,15}$/.test(cleanPhone)) {
      throw new Error('El número debe incluir el código de país, sin +, espacios ni guiones, y tener entre 8 y 15 dígitos. Ejemplo: 5215512345678');
    }
    const runtime = await this.start(id, { targetChatId });
    if (runtime.registered) {
      throw new Error('Este subbot ya está vinculado. Usa .subbot apagar y luego encender si necesitas otra sesión.');
    }
    if (typeof runtime.socket.requestPairingCode !== 'function') {
      throw new Error('Esta versión de Baileys no admite vinculación por número.');
    }
    await this.waitForSocketReady(runtime.socket);
    const code = await runtime.socket.requestPairingCode(cleanPhone);
    const target = normalizeJid(targetChatId || this.config.ownerJid || this.mainSocket.user?.id || '');
    if (!target) throw new Error('No se pudo determinar el chat de destino.');
    await this.mainSocket.sendMessage(target, {
      text: `🔐 Código de vinculación para ${id}:\n\n${code}\n\nAbre WhatsApp en el número secundario y entra en:\nAjustes > Dispositivos vinculados > Vincular con número de teléfono.\n\nEscribe este código antes de que expire.`
    });
    return code;
  }

  async waitForSocketReady(socket) {
    if (typeof socket.waitForSocketOpen === 'function') {
      try {
        await socket.waitForSocketOpen();
        return;
      } catch (error) {
        throw new Error(`No se pudo abrir la conexión con WhatsApp: ${error.message}`);
      }
    }
    if (socket.ws?.isOpen) return;
    throw new Error('La versión de Baileys no permite esperar la conexión WebSocket.');
  }

  async dispatch(runtime, message) {
    if (!message?.message) return;
    const chatId = message.key?.remoteJid;
    if (!chatId || chatId === 'status@broadcast') return;
    const senderAliases = [...new Set(
      (message.key?.fromMe
        ? [runtime.socket.user?.id, runtime.socket.user?.lid]
        : [
            message.key?.participantPn,
            message.key?.senderPn,
            message.key?.participant,
            message.key?.participantLid,
            ...(!String(chatId).endsWith('@g.us') ? [chatId] : [])
          ]
      ).filter(Boolean)
    )];
    const sender = message.key?.fromMe
      ? (runtime.socket.user?.id || runtime.socket.user?.lid || chatId)
      : (
          message.key?.participantPn
          || message.key?.senderPn
          || message.key?.participant
          || message.key?.participantLid
          || chatId
        );
    const quoted = message.message?.extendedTextMessage?.contextInfo?.participant || null;
    await runtime.handler.handleMessage(message, {
      chatId,
      sender,
      senderAliases,
      quoted,
      receivedAt: Date.now()
    });
  }

  async sendQr(id, qrText, targetChatId = '') {
    const target = normalizeJid(targetChatId || this.config.ownerJid || this.mainSocket.user?.id || '');
    if (!target) return;
    const image = await qr.toBuffer(qrText, { type: 'png', width: 720, margin: 2 });
    await this.mainSocket.sendMessage(target, {
      image,
      caption: `🔗 QR de conexión para ${id}\nEscanea este código con el otro WhatsApp.`
    });
  }

  async stop(id) {
    const runtime = this.runtimes.get(String(id || '').toUpperCase());
    if (!runtime) {
      this.update(id, { status: 'OFFLINE' });
      return;
    }
    runtime.stopping = true;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    this.runtimes.delete(runtime.id);
    try {
      if (typeof runtime.socket.end === 'function') await runtime.socket.end();
    } finally {
      this.update(runtime.id, { status: 'OFFLINE' });
    }
  }

  async stopAll() {
    await Promise.all([...this.runtimes.keys()].map(id => this.stop(id)));
  }

  async remove(id) {
    const record = this.get(id);
    if (!record) throw new Error(`Subbot inexistente: ${id}`);
    await this.stop(record.id);
    const subConfig = this.buildConfig(record.id);
    await Promise.all([
      subConfig.sessionDirectory,
      subConfig.dataDirectory,
      subConfig.tempDirectory,
      subConfig.logDirectory
    ].map(directory => fs.promises.rm(directory, { recursive: true, force: true })));
    this.records.delete(record.id);
    this.save();
  }

  requestDelete(sender, id) {
    this.pendingDeletes.set(normalizeJid(sender), String(id).toUpperCase());
  }

  async confirmDelete(sender) {
    const key = normalizeJid(sender);
    const id = this.pendingDeletes.get(key);
    if (!id) return null;
    this.pendingDeletes.delete(key);
    await this.remove(id);
    return id;
  }

  async startExisting() {
    await Promise.all([...this.records.values()].map(record =>
      this.start(record.id).catch(error => {
        this.update(record.id, { status: 'OFFLINE', error: error.message });
        return null;
      })
    ));
  }
}

module.exports = SubbotManager;

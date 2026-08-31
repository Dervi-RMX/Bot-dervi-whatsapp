const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils');

const LEGACY_WELCOME_MESSAGE = '';
const DEFAULT_WELCOME_MESSAGE = 'CYBERGROUP COMMUNITY {user}';
const DEFAULT_RULES_MESSAGE = '📜 Escribe las reglas de la comunidad en este grupo.';

function normalizeJid(jid) {
  const value = String(jid || '').trim();
  if (!value) return '';
  const at = value.indexOf('@');
  if (at === -1) return value.split(':')[0].trim();
  const local = value.slice(0, at).split(':')[0].trim();
  const domain = value.slice(at + 1).trim();
  return local && domain ? `${local}@${domain}` : local;
}

class ModerationManager {
  constructor(config) {
    this.config = config;
    this.state = { chats: {} };
    this.activity = new Map(); // chatId -> sender -> { timestamps, lastWarnAt }
    this.filePath = path.join(config.dataDirectory, 'moderation.json');
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    ensureDir(this.config.dataDirectory);
    if (!fs.existsSync(this.filePath)) {
      this.loaded = true;
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.chats) {
        this.state = parsed;
      }
    } catch {
      this.state = { chats: {} };
    }
    this.loaded = true;
  }

  save() {
    this.load();
    ensureDir(this.config.dataDirectory);
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  ensureChat(chatId) {
    this.load();
    if (!this.state.chats[chatId]) {
      this.state.chats[chatId] = {
        antiSpam: {
          enabled: false,
          windowSec: Math.max(3, Number(this.config.antiSpamDefaultWindowSec || 10)),
          maxMessages: Math.max(2, Number(this.config.antiSpamDefaultMaxMessages || 6)),
          maxWarnings: Math.max(1, Number(this.config.antiSpamDefaultMaxWarnings || 3))
        },
        warnings: {},
        welcome: {
          enabled: false,
          message: DEFAULT_WELCOME_MESSAGE
        },
        antiLinks: { enabled: false },
        rules: {
          enabled: false,
          message: DEFAULT_RULES_MESSAGE
        },
        mutedUsers: {}
      };
    }

    const chat = this.state.chats[chatId];
    if (!chat.antiSpam || typeof chat.antiSpam !== 'object') {
      chat.antiSpam = {
        enabled: false,
        windowSec: Math.max(3, Number(this.config.antiSpamDefaultWindowSec || 10)),
        maxMessages: Math.max(2, Number(this.config.antiSpamDefaultMaxMessages || 6)),
        maxWarnings: Math.max(1, Number(this.config.antiSpamDefaultMaxWarnings || 3))
      };
    }
    if (!chat.warnings || typeof chat.warnings !== 'object') chat.warnings = {};
    if (!chat.welcome || typeof chat.welcome !== 'object') {
      chat.welcome = { enabled: false, message: DEFAULT_WELCOME_MESSAGE };
    } else if (chat.welcome.message === LEGACY_WELCOME_MESSAGE) {
      chat.welcome.message = DEFAULT_WELCOME_MESSAGE;
    }
    if (!chat.antiLinks || typeof chat.antiLinks !== 'object') chat.antiLinks = { enabled: false };
    chat.antiLinks.enabled = Boolean(chat.antiLinks.enabled);
    if (!chat.rules || typeof chat.rules !== 'object') {
      chat.rules = { enabled: false, message: DEFAULT_RULES_MESSAGE };
    }
    chat.rules.enabled = Boolean(chat.rules.enabled);
    chat.rules.message = String(chat.rules.message || DEFAULT_RULES_MESSAGE).slice(0, 2000);
    if (!chat.mutedUsers || typeof chat.mutedUsers !== 'object') chat.mutedUsers = {};
    return chat;
  }

  getAntiSpam(chatId) {
    const chat = this.ensureChat(chatId);
    return { ...chat.antiSpam };
  }

  setAntiSpam(chatId, patch = {}) {
    const chat = this.ensureChat(chatId);
    chat.antiSpam = {
      ...chat.antiSpam,
      ...patch,
      windowSec: Math.max(3, Number(patch.windowSec ?? chat.antiSpam.windowSec)),
      maxMessages: Math.max(2, Number(patch.maxMessages ?? chat.antiSpam.maxMessages)),
      maxWarnings: Math.max(1, Number(patch.maxWarnings ?? chat.antiSpam.maxWarnings))
    };
    this.save();
    return { ...chat.antiSpam };
  }

  getAntiLinks(chatId) {
    const chat = this.ensureChat(chatId);
    return { enabled: Boolean(chat.antiLinks.enabled) };
  }

  setAntiLinks(chatId, patch = {}) {
    const chat = this.ensureChat(chatId);
    chat.antiLinks = {
      ...chat.antiLinks,
      enabled: patch.enabled === undefined
        ? Boolean(chat.antiLinks.enabled)
        : Boolean(patch.enabled)
    };
    this.save();
    return this.getAntiLinks(chatId);
  }

  getRules(chatId) {
    const chat = this.ensureChat(chatId);
    return {
      enabled: Boolean(chat.rules.enabled),
      message: String(chat.rules.message || DEFAULT_RULES_MESSAGE)
    };
  }

  setRules(chatId, patch = {}) {
    const chat = this.ensureChat(chatId);
    const message = patch.message === undefined
      ? chat.rules.message
      : String(patch.message || '').trim().slice(0, 2000);
    chat.rules = {
      enabled: patch.enabled === undefined ? Boolean(chat.rules.enabled) : Boolean(patch.enabled),
      message: message || DEFAULT_RULES_MESSAGE
    };
    this.save();
    return this.getRules(chatId);
  }

  registerWarning(chatId, sender) {
    const antiSpam = this.getAntiSpam(chatId);
    const warnings = this.addWarning(chatId, sender, 1);
    if (warnings >= antiSpam.maxWarnings) {
      this.clearWarnings(chatId, sender);
      return { action: 'ban', warnings, antiSpam };
    }
    return { action: 'warn', warnings, antiSpam };
  }

  getMute(chatId, sender, now = Date.now()) {
    const chat = this.ensureChat(chatId);
    const key = normalizeJid(sender);
    const entry = chat.mutedUsers[key];
    if (!entry) return null;
    if (entry.expiresAt !== null && Number(entry.expiresAt) <= now) {
      delete chat.mutedUsers[key];
      this.save();
      return null;
    }
    return { ...entry, jid: key };
  }

  muteUser(chatId, sender, durationMs = 60 * 60 * 1000, now = Date.now()) {
    const chat = this.ensureChat(chatId);
    const key = normalizeJid(sender);
    const expiresAt = durationMs === null ? null : now + Math.max(60_000, Number(durationMs));
    chat.mutedUsers[key] = { mutedAt: now, expiresAt };
    this.save();
    return { jid: key, mutedAt: now, expiresAt };
  }

  unmuteUser(chatId, sender) {
    const chat = this.ensureChat(chatId);
    const key = normalizeJid(sender);
    const existed = Boolean(chat.mutedUsers[key]);
    delete chat.mutedUsers[key];
    if (existed) this.save();
    return existed;
  }

  getMutedUsers(chatId, now = Date.now()) {
    const chat = this.ensureChat(chatId);
    let changed = false;
    const result = [];
    for (const [jid, entry] of Object.entries(chat.mutedUsers)) {
      const expiresAt = entry?.expiresAt === null ? null : Number(entry?.expiresAt);
      if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
        delete chat.mutedUsers[jid];
        changed = true;
        continue;
      }
      result.push({ jid, mutedAt: Number(entry?.mutedAt) || now, expiresAt });
    }
    if (changed) this.save();
    return result;
  }

  isMuted(chatId, sender, now = Date.now()) {
    return Boolean(this.getMute(chatId, sender, now));
  }

  getWelcome(chatId) {
    this.load();
    const previousMessage = this.state.chats[chatId]?.welcome?.message;
    const chat = this.ensureChat(chatId);
    const result = {
      enabled: Boolean(chat.welcome.enabled),
      message: String(chat.welcome.message || DEFAULT_WELCOME_MESSAGE)
    };
    if (previousMessage === LEGACY_WELCOME_MESSAGE) this.save();
    return result;
  }

  setWelcome(chatId, patch = {}) {
    const chat = this.ensureChat(chatId);
    const nextMessage = patch.message === undefined
      ? chat.welcome.message
      : String(patch.message || '').trim().slice(0, 500);

    chat.welcome = {
      enabled: patch.enabled === undefined ? Boolean(chat.welcome.enabled) : Boolean(patch.enabled),
      message: nextMessage || DEFAULT_WELCOME_MESSAGE
    };
    this.save();
    return this.getWelcome(chatId);
  }

  getGoodbye(chatId) {
    this.load();
    const previousMessage = this.state.chats[chatId]?.goodbye?.message;
    const chat = this.ensureChat(chatId);
    const result = {
      enabled: Boolean(chat.goodbye?.enabled),
      message: String(chat.goodbye?.message || DEFAULT_WELCOME_MESSAGE)
    };
    if (previousMessage === LEGACY_WELCOME_MESSAGE) this.save();
    return result;
  }

  setGoodbye(chatId, patch = {}) {
    const chat = this.ensureChat(chatId);
    const nextMessage = patch.message === undefined
      ? chat.goodbye?.message
      : String(patch.message || '').trim().slice(0, 500);

    chat.goodbye = {
      enabled: patch.enabled === undefined ? Boolean(chat.goodbye?.enabled) : Boolean(patch.enabled),
      message: nextMessage || DEFAULT_WELCOME_MESSAGE
    };
    this.save();
    return this.getGoodbye(chatId);
  }

  getWarnings(chatId, sender) {
    const chat = this.ensureChat(chatId);
    const key = normalizeJid(sender);
    return Number(chat.warnings[key] || 0);
  }

  addWarning(chatId, sender, amount = 1) {
    const chat = this.ensureChat(chatId);
    const key = normalizeJid(sender);
    const current = Number(chat.warnings[key] || 0);
    const next = Math.max(0, current + Number(amount || 0));
    if (next <= 0) delete chat.warnings[key];
    else chat.warnings[key] = next;
    this.save();
    return next;
  }

  clearWarnings(chatId, sender) {
    return this.addWarning(chatId, sender, -9999);
  }

  touchActivity(chatId, sender, now = Date.now()) {
    const chatKey = String(chatId);
    const senderKey = normalizeJid(sender);
    if (!this.activity.has(chatKey)) this.activity.set(chatKey, new Map());
    const chatMap = this.activity.get(chatKey);
    if (!chatMap.has(senderKey)) chatMap.set(senderKey, { timestamps: [], lastWarnAt: 0 });
    return chatMap.get(senderKey);
  }

  evaluateMessage(chatId, sender, now = Date.now()) {
    const antiSpam = this.getAntiSpam(chatId);
    if (!antiSpam.enabled) return { action: 'none', warnings: this.getWarnings(chatId, sender), antiSpam };

    const state = this.touchActivity(chatId, sender, now);
    const windowMs = antiSpam.windowSec * 1000;
    state.timestamps = state.timestamps.filter(ts => now - ts <= windowMs);
    state.timestamps.push(now);

    if (state.timestamps.length <= antiSpam.maxMessages) {
      return { action: 'none', warnings: this.getWarnings(chatId, sender), antiSpam };
    }

    // Cooldown check: prevent issuing warnings too frequently.
    // If no warning has been issued yet (lastWarnAt === 0), we allow the warning.
    if (state.lastWarnAt !== 0 && now - state.lastWarnAt < Math.floor(windowMs / 2)) {
      return { action: 'none', warnings: this.getWarnings(chatId, sender), antiSpam };
    }

    state.lastWarnAt = now;
    state.timestamps = [];
    const warnings = this.addWarning(chatId, sender, 1);
    if (warnings >= antiSpam.maxWarnings) {
      this.clearWarnings(chatId, sender);
      return { action: 'ban', warnings, antiSpam };
    }
    return { action: 'warn', warnings, antiSpam };
  }
}

module.exports = {
  ModerationManager,
  normalizeJid,
  DEFAULT_WELCOME_MESSAGE,
  DEFAULT_RULES_MESSAGE
};
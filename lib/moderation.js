const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils');

function normalizeJid(jid) {
  return String(jid || '').split(':')[0].trim();
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
        warnings: {}
      };
    }
    return this.state.chats[chatId];
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

    if (now - state.lastWarnAt < Math.floor(windowMs / 2)) {
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
  normalizeJid
};


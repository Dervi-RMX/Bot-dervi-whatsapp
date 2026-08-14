const path = require('path');
require('dotenv').config();

const root = __dirname;
const int = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = {
  prefix: process.env.BOT_PREFIX || '.',
  ownerJid: String(process.env.BOT_OWNER_JID || '').trim(),
  maxFileSize: int(process.env.BOT_MAX_FILE_SIZE, 100),
  downloadTimeout: int(process.env.BOT_DOWNLOAD_TIMEOUT, 30000),
  tempDirectory: path.resolve(root, process.env.BOT_TEMP_DIR || 'tmp'),
  sessionDirectory: path.resolve(root, process.env.BOT_SESSION_DIR || 'sessions'),
  logDirectory: path.resolve(root, process.env.BOT_LOG_DIR || 'logs'),
  dataDirectory: path.resolve(root, process.env.BOT_DATA_DIR || 'data'),
  rateLimitWindowMs: int(process.env.BOT_RATE_LIMIT_WINDOW_MS, 3000),
  rateLimitMax: int(process.env.BOT_RATE_LIMIT_MAX, 4),
  pluginTimeoutMs: int(process.env.BOT_PLUGIN_TIMEOUT_MS, 60000),
  antiDeleteEnabled: String(process.env.BOT_ANTI_DELETE || 'true').toLowerCase() === 'true',
  antiDeleteTargetJid: String(process.env.BOT_ANTI_DELETE_TARGET_JID || '').trim(),
  antiSpamDefaultWindowSec: int(process.env.BOT_ANTISPAM_WINDOW_SEC, 10),
  antiSpamDefaultMaxMessages: int(process.env.BOT_ANTISPAM_MAX_MESSAGES, 6),
  antiSpamDefaultMaxWarnings: int(process.env.BOT_ANTISPAM_MAX_WARNINGS, 3)
};

const path = require('path');
require('dotenv').config();

const root = __dirname;

const int = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = {
  prefix: process.env.BOT_PREFIX || '.',

  // Propietario principal - Se detectará automáticamente al iniciar
  // Si se especifica BOT_OWNER_JID en .env, se usará ese valor
  // Si no, se detectará el primer usuario que autentique el bot
  ownerJid: String(process.env.BOT_OWNER_JID || '').trim(),

  // WhatsApp LID, si tu conexión utiliza LID.
  ownerLid: String(process.env.BOT_OWNER_LID || '').trim(),

  maxFileSize: int(process.env.BOT_MAX_FILE_SIZE, 100),
  downloadTimeout: int(process.env.BOT_DOWNLOAD_TIMEOUT, 30000),

  tempDirectory: path.resolve(
    root,
    process.env.BOT_TEMP_DIR || 'tmp'
  ),

  tempFileMaxAgeMs: int(process.env.TEMP_FILE_MAX_AGE, 60 * 60 * 1000),

  sessionDirectory: path.resolve(
    root,
    process.env.BOT_SESSION_DIR || 'sessions'
  ),

  logDirectory: path.resolve(
    root,
    process.env.BOT_LOG_DIR || 'logs'
  ),

  dataDirectory: path.resolve(
    root,
    process.env.BOT_DATA_DIR || 'data'
  ),

  rateLimitWindowMs: int(
    process.env.BOT_RATE_LIMIT_WINDOW_MS,
    3000
  ),

  rateLimitMax: int(
    process.env.BOT_RATE_LIMIT_MAX,
    4
  ),

  pluginTimeoutMs: int(
    process.env.BOT_PLUGIN_TIMEOUT_MS,
    60000
  ),

  requireLinkedUsers:
    String(
      process.env.BOT_REQUIRE_LINKED_USERS || 'true'
    ).toLowerCase() === 'true',

  inviteTtlMs: int(
    process.env.BOT_INVITE_TTL_MS,
    10 * 60 * 1000
  ),

  antiDeleteEnabled:
    String(
      process.env.BOT_ANTI_DELETE || 'true'
    ).toLowerCase() === 'true',

  antiEditEnabled:
    String(
      process.env.BOT_ANTI_EDIT || 'true'
    ).toLowerCase() === 'true',

  antiDeleteTargetJid:
    String(
      process.env.BOT_ANTI_DELETE_TARGET_JID || ''
    ).trim(),

  antiSpamDefaultWindowSec: int(
    process.env.BOT_ANTISPAM_WINDOW_SEC,
    10
  ),

  antiSpamDefaultMaxMessages: int(
    process.env.BOT_ANTISPAM_MAX_MESSAGES,
    6
  ),

  antiSpamDefaultMaxWarnings: int(
    process.env.BOT_ANTISPAM_MAX_WARNINGS,
    3
  ),

  openAiApiKey:
    String(process.env.OPENAI_API_KEY || '').trim(),

  openAiModel:
    String(
      process.env.OPENAI_MODEL || 'gpt-4o-mini'
    ).trim() || 'gpt-4o-mini',

  openAiMaxOutputTokens: int(
    process.env.OPENAI_MAX_OUTPUT_TOKENS,
    800
  ),

  openAiMaxPromptLength: int(
    process.env.OPENAI_MAX_PROMPT_LENGTH,
    4000
  ),

  openAiTimeoutMs: int(
    process.env.OPENAI_TIMEOUT_MS,
    45000
  ),

  geminiApiKey:
    String(process.env.GEMINI_API_KEY || '').trim(),

  geminiModel:
    String(
      process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    ).trim() || 'gemini-2.0-flash',

  geminiMaxOutputTokens: int(
    process.env.GEMINI_MAX_OUTPUT_TOKENS,
    800
  ),

  geminiMaxPromptLength: int(
    process.env.GEMINI_MAX_PROMPT_LENGTH,
    4000
  ),

  geminiTimeoutMs: int(
    process.env.GEMINI_TIMEOUT_MS,
    45000
  )
};
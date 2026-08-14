const fs = require('fs');
const path = require('path');

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  info: '\x1b[36m',
  success: '\x1b[32m',
  warning: '\x1b[33m',
  error: '\x1b[31m',
  command: '\x1b[35m',
  media: '\x1b[34m'
};

let logFile = null;

function ensureLogFile(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'bot-sandbox.log');
}

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(11, 19);
}

function sanitize(value) {
  return String(value ?? '')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
    .replace(/(token|secret|password|apikey|api_key)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]');
}

function writeFile(line) {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  } catch {
    // ignore logging failures
  }
}

function out(level, message, meta) {
  const color = COLORS[level] || COLORS.info;
  const text = sanitize(message);
  const extra = meta ? ` ${sanitize(JSON.stringify(meta))}` : '';
  const line = `[${stamp()}] ${text}${extra}`;
  console.log(`${color}${line}${COLORS.reset}`);
  writeFile(line);
}

module.exports = {
  ensureLogFile,
  info: (message, meta) => out('info', message, meta),
  success: (message, meta) => out('success', message, meta),
  warning: (message, meta) => out('warning', message, meta),
  error: (message, meta) => out('error', message, meta),
  command: (message, meta) => out('command', message, meta),
  media: (message, meta) => out('media', message, meta),
  raw: out,
  COLORS
};


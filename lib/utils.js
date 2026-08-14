const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function randomId(length = 6) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function sanitizeFileName(name, fallback = 'file') {
  const clean = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.\.+/g, '.')
    .trim();
  return clean.length ? clean.slice(0, 120) : fallback;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(text) {
  return String(text || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\uFEFF]/g, '')
    .trim();
}

function extractUrls(text) {
  const input = normalizeText(text);
  const matches = input.match(/https?:\/\/[^\s<>"')\]]+/gi);
  return matches ? [...new Set(matches.map(url => url.replace(/[),.;]+$/g, '')))] : [];
}

function unwrapMessage(message) {
  let current = message?.message || message;
  while (current) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }
    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      continue;
    }
    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      continue;
    }
    if (current.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message;
      continue;
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }
    break;
  }
  return current || {};
}

function getContentType(message) {
  const content = unwrapMessage(message);
  return Object.keys(content)[0] || null;
}

function getMessageContent(message) {
  return unwrapMessage(message);
}

function getMessageText(message) {
  const content = getMessageContent(message);
  const types = [
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'templateButtonReplyMessage',
    'buttonsResponseMessage',
    'listResponseMessage',
    'messageContextInfo'
  ];

  for (const type of types) {
    const value = content[type];
    if (!value) continue;
    if (type === 'conversation') return value;
    if (type === 'extendedTextMessage') return value.text || '';
    if (type === 'imageMessage' || type === 'videoMessage' || type === 'documentMessage') return value.caption || '';
    if (type === 'audioMessage') return value.caption || '';
    if (type === 'stickerMessage') return value.caption || '';
    if (type === 'buttonsResponseMessage') return value.selectedDisplayText || value.selectedButtonId || '';
    if (type === 'listResponseMessage') return value.title || value.description || '';
  }
  return '';
}

function getQuotedMessage(message) {
  const content = getMessageContent(message);
  const fromTypes = ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'];
  for (const type of fromTypes) {
    const value = content[type];
    const quoted = value?.contextInfo?.quotedMessage;
    if (quoted) return quoted;
  }
  return null;
}

function isQuotedMessage(message) {
  return Boolean(getQuotedMessage(message));
}

function getQuotedType(message) {
  const quoted = getQuotedMessage(message);
  if (!quoted) return null;
  return Object.keys(quoted)[0] || null;
}

function getQuotedText(message) {
  const quoted = getQuotedMessage(message);
  if (!quoted) return '';
  const entry = quoted[Object.keys(quoted)[0]];
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return entry.caption || entry.text || '';
}

function getMediaInfo(message) {
  const content = getMessageContent(message);
  const type = getContentType(message);
  const media = type ? content[type] : null;
  if (!media) return null;
  return {
    type,
    mimetype: media.mimetype || media.mimeType || null,
    fileName: media.fileName || media.caption || null,
    fileLength: media.fileLength || media.fileSize || null,
    seconds: media.seconds || media.duration || null,
    width: media.width || null,
    height: media.height || null,
    url: media.url || null,
    directPath: media.directPath || null,
    jpegThumbnail: media.jpegThumbnail || null
  };
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function ipToBigInt(ip) {
  if (net.isIP(ip) === 4) {
    return ip.split('.').reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
  }
  if (net.isIP(ip) === 6) {
    const normalized = ip.split('::');
    const left = normalized[0] ? normalized[0].split(':') : [];
    const right = normalized[1] ? normalized[1].split(':') : [];
    const parts = [
      ...left,
      ...Array(8 - left.length - right.length).fill('0'),
      ...right
    ].map(part => parseInt(part || '0', 16));
    return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
  }
  return null;
}

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    );
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    );
  }
  return false;
}

async function validateSafeUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input));
  } catch {
    return { valid: false, reason: 'URL inválida' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, reason: 'Protocolo no permitido' };
  }

  const hostname = parsed.hostname;
  const blockedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (blockedHosts.has(hostname.toLowerCase())) {
    return { valid: false, reason: 'Host bloqueado' };
  }

  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { valid: false, reason: 'IP privada bloqueada' };
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.some(entry => isPrivateIp(entry.address))) {
      return { valid: false, reason: 'Destino privado bloqueado' };
    }
  } catch {
    return { valid: false, reason: 'No fue posible resolver el host' };
  }

  return { valid: true, url: parsed.toString() };
}

function safeJoin(root, fileName) {
  const target = path.resolve(root, fileName);
  const base = path.resolve(root);
  if (!target.startsWith(base + path.sep) && target !== base) {
    throw new Error('Path traversal detectado');
  }
  return target;
}

function getFileExtensionFromMime(mimetype) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'text/plain': '.txt'
  };
  return map[String(mimetype || '').toLowerCase()] || '';
}

module.exports = {
  ensureDir,
  randomId,
  sanitizeFileName,
  formatBytes,
  formatDuration,
  sleep,
  normalizeText,
  extractUrls,
  unwrapMessage,
  getContentType,
  getMessageContent,
  getMessageText,
  getQuotedMessage,
  isQuotedMessage,
  getQuotedType,
  getQuotedText,
  getMediaInfo,
  isHttpUrl,
  isPrivateIp,
  validateSafeUrl,
  safeJoin,
  getFileExtensionFromMime
};

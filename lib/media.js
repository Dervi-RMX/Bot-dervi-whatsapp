const fs = require('fs');
const path = require('path');
const { formatBytes, formatDuration, sanitizeFileName, getFileExtensionFromMime } = require('./utils');

function inferKindFromMime(mime = '') {
  const lower = String(mime).toLowerCase();
  if (lower.startsWith('image/')) return 'image';
  if (lower.startsWith('video/')) return 'video';
  if (lower.startsWith('audio/')) return 'audio';
  if (lower === 'application/pdf') return 'document';
  if (lower.includes('webp')) return 'sticker';
  return 'document';
}

function buildMediaInfo(content) {
  const media = content || {};
  const kind = inferKindFromMime(media.mimeType || media.mimetype || '');
  const sizeBytes = Number(media.fileLength || media.fileSize || 0) || null;
  return {
    kind,
    mimeType: media.mimeType || media.mimetype || null,
    fileName: sanitizeFileName(media.fileName || `archivo${getFileExtensionFromMime(media.mimeType || media.mimetype || '') || ''}`),
    sizeBytes,
    seconds: media.seconds || media.duration || null,
    width: media.width || null,
    height: media.height || null
  };
}

function formatMediaInfo(content, fallbackType = 'Documento') {
  const info = buildMediaInfo(content);
  const typeName = {
    image: 'Imagen',
    video: 'Video',
    audio: 'Audio',
    document: 'Documento',
    sticker: 'Sticker'
  }[info.kind] || fallbackType;

  const lines = [
    '╭────── INFORMACIÓN ──────╮',
    '',
    `Tipo: ${typeName}`
  ];

  if (info.fileName) lines.push(`Nombre: ${info.fileName}`);
  if (info.mimeType) lines.push(`Formato: ${info.mimeType.split('/').pop().toUpperCase()}`);
  if (info.sizeBytes !== null) lines.push(`Tamaño: ${formatBytes(info.sizeBytes)}`);
  if (info.seconds !== null) lines.push(`Duración: ${formatDuration(info.seconds)}`);
  if (info.width && info.height) lines.push(`Resolución: ${info.width}x${info.height}`);
  lines.push('', '╰─────────────────────────╯');
  return lines.join('\n');
}

function inferOutboundKindFromMime(mime = '') {
  return inferKindFromMime(mime);
}

function buildOutboundPayload(filePath, meta = {}) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = meta.mimeType || meta.mimetype || '';
  const kind = meta.kind || inferOutboundKindFromMime(mime) || inferKindFromMime(mime);
  const fileName = sanitizeFileName(meta.fileName || path.basename(filePath));

  if (kind === 'image') {
    return { image: buffer, caption: meta.caption || '' };
  }
  if (kind === 'video') {
    return { video: buffer, caption: meta.caption || '' };
  }
  if (kind === 'audio') {
    return { audio: buffer, mimetype: mime || undefined, ptt: Boolean(meta.ptt) };
  }
  if (kind === 'sticker') {
    return { sticker: buffer };
  }
  return {
    document: buffer,
    mimetype: mime || undefined,
    fileName: fileName || `archivo${ext || ''}`,
    caption: meta.caption || ''
  };
}

module.exports = {
  buildMediaInfo,
  formatMediaInfo,
  buildOutboundPayload,
  inferKindFromMime,
  inferOutboundKindFromMime
};


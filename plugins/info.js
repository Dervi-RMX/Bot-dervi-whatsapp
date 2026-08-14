const fs = require('fs');
const path = require('path');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadUrlToTempFile } = require('../lib/downloader');
const { getQuotedMessage, getQuotedType, extractUrls, getMediaInfo, getMessageContent, getContentType, formatBytes, formatDuration } = require('../lib/utils');

function toHex(value, max = 24) {
  if (!value) return null;
  try {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const hex = buffer.toString('hex');
    return hex.length > max ? `${hex.slice(0, max)}...` : hex;
  } catch {
    return null;
  }
}

function val(input) {
  if (input === null || input === undefined || input === '') return 'N/D';
  return String(input);
}

function bool(input) {
  if (input === null || input === undefined) return 'N/D';
  return input ? 'Sí' : 'No';
}

function pushLine(lines, label, value) {
  if (value === null || value === undefined || value === '') return;
  lines.push(`${label}: ${value}`);
}

function detectKindFromType(type) {
  if (!type) return 'Desconocido';
  if (type === 'imageMessage') return 'Imagen';
  if (type === 'videoMessage') return 'Video';
  if (type === 'audioMessage') return 'Audio';
  if (type === 'documentMessage') return 'Documento';
  if (type === 'stickerMessage') return 'Sticker';
  return type;
}

function buildMediaInfoBlock(message, detection, mediaInfo) {
  const content = getMessageContent(message);
  const type = getContentType(message);
  const media = type ? content[type] : null;
  if (!media) return null;

  const lines = [
    '╭────── INFORMACIÓN ──────╮',
    '',
    `Tipo: ${detectKindFromType(type)}`,
    `Origen: ${detection?.source === 'quoted-message' ? 'Citado' : 'Actual'}`
  ];

  pushLine(lines, 'Mime', val(mediaInfo?.mimetype || mediaInfo?.mimeType || media?.mimetype || media?.mimeType));
  pushLine(lines, 'Nombre', val(mediaInfo?.fileName || media?.fileName));
  pushLine(lines, 'Extensión', path.extname(String(mediaInfo?.fileName || media?.fileName || '')).replace('.', '').toUpperCase() || 'N/D');

  const sizeBytes = Number(mediaInfo?.fileLength || media?.fileLength || media?.fileSize || 0) || null;
  if (sizeBytes !== null) {
    pushLine(lines, 'Tamaño', `${formatBytes(sizeBytes)} (${sizeBytes} bytes)`);
  }

  const seconds = Number(mediaInfo?.seconds || media?.seconds || media?.duration || 0) || null;
  if (seconds !== null) {
    pushLine(lines, 'Duración', `${formatDuration(seconds)} (${seconds}s)`);
  }

  const width = mediaInfo?.width || media?.width;
  const height = mediaInfo?.height || media?.height;
  if (width && height) pushLine(lines, 'Resolución', `${width}x${height}`);

  pushLine(lines, 'PTT', bool(media?.ptt));
  pushLine(lines, 'ViewOnce', bool(media?.viewOnce));
  pushLine(lines, 'GIF', bool(media?.gifPlayback));
  pushLine(lines, 'Thumbnail', bool(Boolean(media?.jpegThumbnail)));
  pushLine(lines, 'Caption', media?.caption ? media.caption.slice(0, 120) : null);

  pushLine(lines, 'MediaKeyTs', media?.mediaKeyTimestamp);
  pushLine(lines, 'DirectPath', mediaInfo?.directPath || media?.directPath);
  pushLine(lines, 'URL interna', mediaInfo?.url || media?.url);

  pushLine(lines, 'SHA256', toHex(media?.fileSha256));
  pushLine(lines, 'ENC_SHA256', toHex(media?.fileEncSha256));
  pushLine(lines, 'MediaKey', toHex(media?.mediaKey));

  const contextInfo = media?.contextInfo || {};
  pushLine(lines, 'Forwarded', bool(contextInfo?.isForwarded));
  pushLine(lines, 'ForwardingScore', contextInfo?.forwardingScore);

  lines.push('', '╰─────────────────────────╯');
  return lines.join('\n');
}

module.exports = {
  name: 'info',
  aliases: [],
  description: 'Muestra información del contenido citado o actual',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const quoted = getQuotedMessage(context.message);
    const quotedType = getQuotedType(context.message);

    if (detection.type === 'url' && detection.url) {
      const temp = await downloadUrlToTempFile(detection.url, context.handler.config.tempDirectory, {
        maxBytes: context.handler.config.maxFileSize,
        timeout: context.handler.config.downloadTimeout
      }).catch(() => null);
      if (temp?.filePath) {
        const stat = await fs.promises.stat(temp.filePath).catch(() => null);
        const response = [
          '╭────── INFORMACIÓN ──────╮',
          '',
          'Tipo: URL',
          `Origen: ${detection?.source === 'quoted-message' ? 'Citada' : 'Actual'}`,
          `URL: ${temp.sourceUrl || detection.url}`,
          `Host: ${new URL(temp.sourceUrl || detection.url).host}`,
          `Formato: ${(temp.mimeType || 'N/D').split('/').pop().toUpperCase()}`,
          stat ? `Tamaño: ${require('../lib/utils').formatBytes(stat.size)}` : '',
          '',
          '╰─────────────────────────╯'
        ].filter(Boolean).join('\n');
        await context.reply(response);
        await fs.promises.unlink(temp.filePath).catch(() => null);
        return;
      }
    }

    if (detection.type === 'image' || detection.type === 'video' || detection.type === 'audio' || detection.type === 'document' || detection.type === 'sticker') {
      const sourceMessage = detection.source === 'quoted-message'
        ? detection.message
        : (quoted || context.message);
      const mediaInfo = getMediaInfo(sourceMessage) || context.mediaInfo || getMediaInfo(context.message);
      const infoBlock = buildMediaInfoBlock(sourceMessage, detection, mediaInfo);
      if (infoBlock) {
        await context.reply(infoBlock);
        return;
      }
      await context.reply('⚠️ No fue posible extraer metadatos del contenido.');
      return;
    }

    const urls = extractUrls(detection.text || '');
    if (!quoted && !urls.length) {
      await context.reply('⚠️ No encontré información compatible para analizar.');
      return;
    }

    if (quotedType) {
      const mediaInfo = getMediaInfo({ message: quoted }) || context.mediaInfo || getMediaInfo(context.message);
      const infoBlock = buildMediaInfoBlock({ message: quoted }, detection, mediaInfo);
      if (infoBlock) {
        await context.reply(infoBlock);
        return;
      }
      await context.reply(`Tipo citado: ${quotedType}`);
      return;
    }

    await context.reply('⚠️ No encontré información compatible para analizar.');
  }
};

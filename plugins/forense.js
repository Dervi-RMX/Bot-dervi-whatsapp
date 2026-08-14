const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadQuotedMedia } = require('../lib/downloader');
const { extractUrls, validateSafeUrl, getMessageContent, getContentType, getMediaInfo, formatBytes, formatDuration } = require('../lib/utils');

function hexHead(buffer, bytes = 16) {
  return Buffer.from(buffer).subarray(0, bytes).toString('hex');
}

function hashFile(filePath, algo) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function calcUrlRisk(urlObj) {
  const reasons = [];
  const host = urlObj.hostname.toLowerCase();
  const suspiciousTlds = ['.zip', '.mov', '.top', '.xyz', '.click', '.rest', '.country'];
  const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'cutt.ly', 'rebrand.ly'];
  const dangerousExt = ['.exe', '.scr', '.bat', '.cmd', '.js', '.vbs', '.msi', '.ps1'];

  if (host.startsWith('xn--')) reasons.push('dominio punycode');
  if (shorteners.includes(host)) reasons.push('acortador de URL');
  if (suspiciousTlds.some(tld => host.endsWith(tld))) reasons.push('TLD sospechoso');
  if ((urlObj.pathname.match(/\./g) || []).length > 3) reasons.push('ruta compleja');
  if ((urlObj.search || '').length > 120) reasons.push('query muy larga');
  if (dangerousExt.some(ext => urlObj.pathname.toLowerCase().endsWith(ext))) reasons.push('extensión ejecutable');
  if (host.split('.').length >= 5) reasons.push('muchos subdominios');

  let level = 'Bajo';
  if (reasons.length >= 4) level = 'Alto';
  else if (reasons.length >= 2) level = 'Medio';
  return { level, reasons };
}

function getMediaLabel(type) {
  switch (type) {
    case 'imageMessage': return 'Imagen';
    case 'videoMessage': return 'Video';
    case 'audioMessage': return 'Audio';
    case 'documentMessage': return 'Documento';
    case 'stickerMessage': return 'Sticker';
    default: return type || 'Desconocido';
  }
}

module.exports = {
  name: 'forense',
  aliases: ['forensic'],
  description: 'Analiza indicadores forenses de URL/archivo citado',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls[0] || null;

    if (url) {
      const safe = await validateSafeUrl(url);
      if (!safe.valid) {
        await context.reply(`🧪 FORENSE (URL)\n\nEstado: bloqueada\nMotivo: ${safe.reason}`);
        return;
      }

      const parsed = new URL(safe.url);
      const risk = calcUrlRisk(parsed);
      await context.reply(
        [
          '🧪 FORENSE (URL)',
          '',
          `URL: ${safe.url}`,
          `Host: ${parsed.host}`,
          `Protocolo: ${parsed.protocol.replace(':', '').toUpperCase()}`,
          `Path: ${parsed.pathname || '/'}`,
          `Query params: ${Array.from(parsed.searchParams.keys()).length}`,
          `Riesgo heurístico: ${risk.level}`,
          risk.reasons.length ? `Señales: ${risk.reasons.join(', ')}` : 'Señales: ninguna crítica',
          '',
          'Tip: usa .vt para reputación multi-motor.'
        ].join('\n')
      );
      return;
    }

    if (!['image', 'video', 'audio', 'document', 'sticker'].includes(detection.type)) {
      await context.reply('⚠️ Responde a una URL o archivo (PDF, imagen, video, audio, etc.) y usa .forense');
      return;
    }

    const sourceMessage = detection.source === 'quoted-message' ? detection.message : context.message;
    const filePath = await downloadQuotedMedia(sourceMessage, context.handler.config.tempDirectory);
    try {
      const stat = await fs.promises.stat(filePath);
      const [md5, sha1, sha256] = await Promise.all([
        hashFile(filePath, 'md5'),
        hashFile(filePath, 'sha1'),
        hashFile(filePath, 'sha256')
      ]);
      const head = await fs.promises.readFile(filePath);

      const msgObj = detection.source === 'quoted-message' ? { message: detection.message } : context.message;
      const content = getMessageContent(msgObj);
      const type = getContentType(msgObj);
      const media = type ? content[type] : null;
      const info = getMediaInfo(msgObj) || {};

      await context.reply(
        [
          '🧪 FORENSE (ARCHIVO)',
          '',
          `Tipo: ${getMediaLabel(type)}`,
          `Nombre: ${info.fileName || media?.fileName || path.basename(filePath)}`,
          `Mime: ${info.mimetype || media?.mimetype || 'N/D'}`,
          `Tamaño: ${formatBytes(stat.size)} (${stat.size} bytes)`,
          info.seconds ? `Duración: ${formatDuration(info.seconds)}` : null,
          info.width && info.height ? `Resolución: ${info.width}x${info.height}` : null,
          `MD5: ${md5}`,
          `SHA1: ${sha1}`,
          `SHA256: ${sha256}`,
          `Magic (hex): ${hexHead(head, 16)}`,
          media?.viewOnce !== undefined ? `ViewOnce: ${media.viewOnce ? 'Sí' : 'No'}` : null,
          media?.ptt !== undefined ? `PTT: ${media.ptt ? 'Sí' : 'No'}` : null,
          '',
          'Tip: usa .vt respondiendo este mismo archivo.'
        ].filter(Boolean).join('\n')
      );
    } finally {
      await fs.promises.unlink(filePath).catch(() => null);
    }
  }
};


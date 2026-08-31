const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'instagram',
  aliases: ['ig'],
  description: 'Descarga contenido de Instagram (fotos, videos, reels, historias)',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /instagram\.com/i.test(u));

    if (!url) {
      await context.reply('⚠️ No se detectó una URL de Instagram válida.\n\nUsa: .instagram <url_de_instagram>');
      return;
    }

    const safe = await validateSafeUrl(url);
    if (!safe.valid) {
      await context.reply('⚠️ URL no segura o bloqueada.');
      return;
    }

    try {
      // Send processing indicator
      try {
        if (typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('composing', context.chatId);
        }
      } catch (e) {
        // ignore presence errors
      }

      const dl = await downloadWithYtDlp(
        safe.url,
        context.handler.config.tempDirectory,
        { timeout: Math.max(120000, Number(context.handler.config.downloadTimeout || 120000)), format: 'bestvideo+bestaudio/best', mergeOutputFormat: 'mp4' }
      );

      if (!dl || !dl.filePath) {
        throw new Error('No se descargó el archivo');
      }
      if (!fs.existsSync(dl.filePath)) {
        throw new Error('Archivo descargado no encontrado: ' + dl.filePath);
      }

      // Determine mime type and kind from file extension
      const ext = path.extname(dl.filePath).toLowerCase();
      let mimeType = '';
      switch (ext) {
        case '.mp4': mimeType = 'video/mp4'; break;
        case '.mov': mimeType = 'video/quicktime'; break;
        case '.mkv': mimeType = 'video/x-matroska'; break;
        case '.webm': mimeType = 'video/webm'; break;
        case '.jpg':
        case '.jpeg': mimeType = 'image/jpeg'; break;
        case '.png': mimeType = 'image/png'; break;
        case '.gif': mimeType = 'image/gif'; break;
        case '.webp': mimeType = 'image/webp'; break;
        default: mimeType = '';
      }
      let kind = 'document';
      if (mimeType.startsWith('image/')) kind = 'image';
      else if (mimeType.startsWith('video/')) kind = 'video';
      else if (mimeType.startsWith('audio/')) kind = 'audio';
      else if (mimeType === 'application/pdf') kind = 'document';
      else if (mimeType.includes('webp')) kind = 'sticker';

      await context.sendTempFile(dl.filePath, {
        fileName: path.basename(dl.filePath),
        mimeType: mimeType,
        kind: kind,
        caption: `📷 ${kind === 'video' ? 'video' : 'foto'} de Instagram descargado`
      });

      // Clear presence
      try {
        if (typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
      } catch (e) {
        // ignore
      }
    } catch (error) {
      // Clear presence on error
      try {
        if (typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
      } catch (e) {
        // ignore
      }

      context.handler.logger?.warning?.('Instagram download failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible descargar el contenido de Instagram. El contenido podría no estar disponible, ser privado ou avoir restricciones.');
    }
  }
};
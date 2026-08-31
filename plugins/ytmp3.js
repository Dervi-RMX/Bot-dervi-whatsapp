const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const path = require('path');

module.exports = {
  name: 'ytmp3',
  aliases: ['youtube-mp3'],
  description: 'Descarga audio de YouTube en formato MP3',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /youtu\.be|youtube\.com/i.test(u));

    if (!url) {
      await context.reply('⚠️ No se detectó una URL de YouTube válida.\n\nUsa: .ytmp3 <url_de_youtube>');
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

      // Download audio only using yt-dlp format selection
      const dl = await downloadWithYtDlp(
        safe.url,
        context.handler.config.tempDirectory,
        {
          timeout: Math.max(120000, Number(context.handler.config.downloadTimeout || 120000)),
          format: 'bestaudio[ext=m4a]/bestaudio/best'  // Prefer m4a, fallback to best audio, then best overall
        }
      );

      if (!dl || !dl.filePath) {
        throw new Error('No se descargó el archivo de audio');
      }

      await context.sendTempFile(dl.filePath, {
        fileName: path.basename(dl.filePath),
        mimeType: dl.mimeType || 'audio/mpeg',
        kind: 'audio',
        caption: '🎵 Audio de YouTube descargado (MP3)'
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

      context.handler.logger?.warning?.('YouTube audio download failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible descargar el audio de YouTube. El video podría no estar disponible, tener restricciones de edad o derechos de autor.');
    }
  }
};

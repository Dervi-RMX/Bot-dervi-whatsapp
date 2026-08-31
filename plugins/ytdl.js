const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const path = require('path');

module.exports = {
  name: 'ytdl',
  aliases: ['youtube-dl'],
  description: 'Descarga videos de YouTube en mejor calidad disponible',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /youtu\.be|youtube\.com/i.test(u));

    if (!url) {
      await context.reply('⚠️ No se detectó una URL de YouTube válida.\n\nUsa: .ytdl <url_de_youtube>');
      return;
    }

    const safe = await validateSafeUrl(url);
    if (!safe.valid) {
      await context.reply('⚠️ URL no segura o bloqueada.');
      return;
    }

    try {
      // Send processing indicator (no message, just presence)
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
        { timeout: Math.max(120000, Number(context.handler.config.downloadTimeout || 120000)) }
      );

      if (!dl || !dl.filePath) {
        throw new Error('No se descargó el archivo');
      }

      await context.sendTempFile(dl.filePath, {
        fileName: path.basename(dl.filePath),
        mimeType: dl.mimeType || 'video/mp4',
        kind: 'video',
        caption: '🎬 Video de YouTube descargado'
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

      context.handler.logger?.warning?.('YouTube download failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible descargar el video de YouTube. El video podría no estar disponible, tener restricciones de edad o direitos de autor.');
    }
  }
};

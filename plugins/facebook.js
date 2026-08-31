const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const path = require('path');

module.exports = {
  name: 'facebook',
  aliases: ['fb'],
  description: 'Descarga videos de Facebook',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /facebook\.com|fb\.watch/i.test(u));

    if (!url) {
      await context.reply('⚠️ No se detectó una URL de Facebook válida.\n\nUsa: .facebook <url_de_facebook>');
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
        { timeout: Math.max(120000, Number(context.handler.config.downloadTimeout || 120000)) }
      );

      if (!dl || !dl.filePath) {
        throw new Error('No se descargó el archivo');
      }

      await context.sendTempFile(dl.filePath, {
        fileName: path.basename(dl.filePath),
        mimeType: dl.mimeType || 'video/mp4',
        kind: 'video',
        caption: '📹 Video de Facebook descargado'
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

      context.handler.logger?.warning?.('Facebook download failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible descargar el video de Facebook. El video podría no estar disponible, ser privado o avoir restricciones.');
    }
  }
};

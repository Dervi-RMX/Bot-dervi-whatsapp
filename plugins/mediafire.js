const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const path = require('path');

module.exports = {
  name: 'mediafire',
  aliases: ['mf'],
  description: 'Descarga archivos de MediaFire',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /mediafire\.com/i.test(u));

    if (!url) {
      await context.reply('⚠️ No se detectó una URL de MediaFire válida.\n\nUsa: .mediafire <url_de_mediafire>');
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
        mimeType: dl.mimeType || 'application/octet-stream',
        kind: 'file',
        caption: '📁 Archivo de MediaFire descargado'
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

      context.handler.logger?.warning?.('MediaFire download failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible descargar el archivo de MediaFire. El archivo podría no estar disponible, haber sido eliminado ou avoir restricciones.');
    }
  }
};

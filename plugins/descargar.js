const path = require('path');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { getQuotedMessage } = require('../lib/utils');

module.exports = {
  name: 'descargar',
  aliases: ['download'],
  description: 'Descarga contenido citado o una URL compatible',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    let filePath = null;
    let download = null;

    if (detection.type === 'url' && detection.url) {
      download = await downloadUrlToTempFile(detection.url, context.handler.config.tempDirectory, {
        maxBytes: context.handler.config.maxFileSize,
        timeout: context.handler.config.downloadTimeout
      });
      filePath = download.filePath;
    } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(detection.type)) {
      const source = getQuotedMessage(context.message) || context.message;
      filePath = await downloadQuotedMedia(source, context.handler.config.tempDirectory);
    }

    if (!filePath) {
      await context.reply('⚠️ No encontré contenido descargable.');
      return;
    }

    await context.sendTempFile(filePath, {
      fileName: context.mediaInfo?.fileName || (download ? path.basename(new URL(download.sourceUrl).pathname) : path.basename(filePath)),
      mimeType: download?.mimeType || context.mediaInfo?.mimetype || '',
      kind: download?.kind || detection.type
    });
  }
};

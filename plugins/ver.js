const fs = require('fs');
const path = require('path');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { getQuotedMessage } = require('../lib/utils');

module.exports = {
  name: 'ver',
  aliases: ['view'],
  description: 'Procesa y reenvía el contenido citado o actual',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);

    if (detection.type === 'url' && detection.url) {
      const download = await downloadUrlToTempFile(detection.url, context.handler.config.tempDirectory, {
        maxBytes: context.handler.config.maxFileSize,
        timeout: context.handler.config.downloadTimeout
      });
      await context.sendTempFile(download.filePath, {
        fileName: path.basename(new URL(download.sourceUrl || detection.url).pathname) || 'archivo',
        mimeType: download.mimeType || '',
        kind: download.kind || 'document'
      });
      return;
    }

    if (['image', 'video', 'audio', 'document', 'sticker'].includes(detection.type)) {
      const source = detection.source === 'quoted-message'
        ? detection.message
        : (getQuotedMessage(context.message) || context.message);
      const filePath = await downloadQuotedMedia(source, context.handler.config.tempDirectory);
      await context.sendTempFile(filePath, {
        fileName: detection.fileName || context.mediaInfo?.fileName || 'archivo',
        mimeType: detection.mimeType || context.mediaInfo?.mimetype || '',
        kind: detection.type
      });
      return;
    }

    await context.reply(
      [
        '⚠️ No encontré ningún contenido para procesar.',
        '',
        'Responde a una imagen, vídeo, audio, documento o mensaje con una URL y utiliza:',
        '',
        '.ver'
      ].join('\n')
    );
  }
};

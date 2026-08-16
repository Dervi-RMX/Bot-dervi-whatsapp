const path = require('path');
const { downloadWithYtDlp } = require('../lib/downloader');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { getQuotedMessage } = require('../lib/utils');

module.exports = {
  name: 'descargar',
  aliases: ['download'],
  description: 'Descarga contenido citado o URLs seguras (no YouTube)',
  async execute(context) {
    const query = context.args && context.args.length > 0 ? context.args.join(' ') : '';
    const detection = context.currentDetection || detectMessageContent(context.message);
    let filePath = null;
    let mimeType = '';
    let fileName = '';
    let kind = '';
    let caption = '';

    // Modo 1: Contenido citado (imagen, video, audio, documento)
    if (detection.type && detection.type !== 'text') {
      try {
        if (detection.type === 'url' && detection.url) {
          const download = await downloadUrlToTempFile(detection.url, context.handler.config.tempDirectory, {
            maxBytes: context.handler.config.maxFileSize,
            timeout: context.handler.config.downloadTimeout
          });
          filePath = download.filePath;
          mimeType = download.mimeType || '';
          kind = download.kind || 'file';
          fileName = path.basename(new URL(detection.url).pathname) || 'archivo';
          caption = '📥 Descarga de URL';
        } else {
          const source = getQuotedMessage(context.message) || context.message;
          filePath = await downloadQuotedMedia(source, context.handler.config.tempDirectory);
          const media = context.mediaInfo || {};
          mimeType = media.mimetype || '';
          kind = media.type || detection.type || 'file';
          fileName = media.fileName || 'archivo';
          caption = '📥 Contenido citado';
        }
      } catch (error) {
        console.error('Error en contenido citado:', error);
      }
    }

    // Modo 2: Si es una imagen, ofrecer convertirla a sticker
    if (!filePath && detection.type === 'image' && context.message?.message?.imageMessage) {
      try {
        const buffer = await context.client.downloadMediaMessage(context.message, 'image');
        if (buffer) {
          const stickerPath = path.join(context.handler.config.tempDirectory || 'tmp', `${randomId(8)}.webp`);
          await fs.promises.writeFile(stickerPath, buffer);

          await context.sendTempFile(stickerPath, {
            fileName: 'sticker.webp',
            mimeType: 'image/webp',
            kind: 'sticker',
            caption: '🎨 Sticker generado de tu imagen'
          });
          return;
        }
      } catch (error) {
        console.error('Error generando sticker:', error);
      }
    }

    // Si no hay archivo, mostrar error
    if (!filePath) {
      await context.reply(`⚠️ No encontré contenido descargable.\n\n${context.message?.message
        ? 'Responde a un mensaje con .descargar'
        : 'Envía un mensaje con contenido multimedia o una URL segura'}`);
      return;
    }

    await context.sendTempFile(filePath, {
      fileName,
      mimeType,
      kind,
      caption
    });
  },

  // Helper formatear bytes
  formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
  }
};
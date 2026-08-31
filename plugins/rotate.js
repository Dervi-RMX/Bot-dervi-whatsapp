const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { buildOutboundPayload, inferOutboundKindFromMime } = require('../lib/media');

function isUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  name: 'rotate',
  aliases: [],
  description: 'Rota una imagen: .rotate [ángulo] [url_o_responder_a_imagen] (ángulo: 90, 180, 270)',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const angle = parseInt(args[0]);
    if (![90, 180, 270].includes(angle)) {
      await context.reply(`⚠️ Ángulo de rotación inválido. Use 90, 180 o 270 grados.`);
      return;
    }

    // Send processing indicator
    let presenceSent = false;
    try {
      if (typeof context.client.sendPresenceUpdate === 'function') {
        await context.client.sendPresenceUpdate('composing', context.chatId);
        presenceSent = true;
      }
    } catch (e) {
      // ignore presence errors
    }

    try {
      let filePath = null;
      let sourceType = '';

      // Determine source: quoted message or URL in args
      const detection = context.currentDetection || detectMessageContent(context.message);

      // Check if there is a quoted message that is an image
      if (context.quotedMessage &&
          ['image', 'video', 'sticker'].includes(detection.type)) {
        filePath = await downloadQuotedMedia(context.quotedMessage, context.handler.config.tempDirectory);
        sourceType = 'quoted';
      }
      // Check if args contain a URL (beyond the angle)
      else if (args.length > 1) {
        // The URL would be in args starting from index 1
        const potentialUrl = args.slice(1).join(' ').trim();
        if (isUrl(potentialUrl)) {
          const safe = await validateSafeUrl(potentialUrl);
          if (!safe.valid) {
            throw new Error('URL no segura');
          }
          filePath = (await downloadUrlToTempFile(safe.url, context.handler.config.tempDirectory)).filePath;
          sourceType = 'url';
        }
      }

      if (!filePath) {
        await context.reply(`⚠️ Por favor, responde a una imagen o proporciona una URL de imagen.\n\nUsa: .rotate [ángulo] [url_o_responder_a_imagen]`);
        return;
      }

      // Process image with sharp
      const outputPath = path.join(context.handler.config.tempDirectory, `rotate_${Date.now()}.png`);
      await sharp(filePath)
        .rotate(angle)
        .toFile(outputPath);

      // Send the processed image
      await context.sendTempFile(outputPath, {
        fileName: `rotate_${path.basename(filePath)}`,
        mimeType: 'image/png',
        kind: 'image',
        caption: `🔄 Imagen rotada ${angle}°`
      });

      // Clean up input file
      try {
        await fs.promises.unlink(filePath);
      } catch (e) {
        // ignore
      }
    } catch (error) {
      // Clear presence on error
      try {
        if (presenceSent && typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
      } catch (e) {
        // ignore
      }

      // Clean up any temporary files
      if (filePath && fs.existsSync(filePath)) {
        try {
          await fs.promises.unlink(filePath);
        } catch (e) {
          // ignore
        }
      }

      context.handler.logger?.warning?.('Rotate processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible rotar la imagen. Asegúrate de que la imagen sea válida y vuelva a intentarlo.');
    } finally {
      // ensure any processing indicator is cleared
      try {
        if (presenceSent && typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
      } catch (e) {
        // ignore
      }
    }
  }
};
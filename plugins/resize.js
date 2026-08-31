const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { detectMessageContent } = require('../lib/content-detector');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { extractUrls, validateSafeUrl } = require('../lib/utils');

function isUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  name: 'resize',
  aliases: [],
  description: 'Redimensiona una imagen: .resize [ancho] [alto] [url_o_responder_a_imagen]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const width = parseInt(args[0]);
    const height = parseInt(args[1]);
    if ((isNaN(width) || width <= 0) && (isNaN(height) || height <= 0)) {
      await context.reply(`⚠️ Debes proporcionar al menos una dimensión válida (ancho o alto mayor que cero).`);
      return;
    }
    // If one dimension is NaN or <=0, we'll compute it later to preserve aspect ratio

    // Determine image source: quoted message or URL in args
    let imageSource = null;
    let sourceType = '';

    // Check if there is a quoted message that is an image
    const detection = context.currentDetection || detectMessageContent(context.message);
    if (context.quotedMessage &&
        ['image', 'video', 'sticker'].includes(detection.type)) {
      imageSource = context.quotedMessage;
      sourceType = 'quoted';
    } else {
      // Look for a URL in the args (skip the first two args if they are width and height)
      const urlArgs = args.slice(2).join(' ').trim();
      if (urlArgs) {
        const urls = extractUrls(urlArgs);
        const validUrl = urls.find(u => validateSafeUrl(u).valid);
        if (validUrl) {
          imageSource = validUrl;
          sourceType = 'url';
        }
      }
    }

    if (!imageSource) {
      await context.reply(`⚠️ Por favor, responde a una imagen o proporciona una URL de imagen.\n\nUsa: .resize [ancho] [alto] [url_o_responder_a_imagen]`);
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
      let filePath;
      if (sourceType === 'quoted') {
        filePath = await downloadQuotedMedia(imageSource, context.handler.config.tempDirectory);
      } else {
        // URL
        const safe = await validateSafeUrl(imageSource);
        if (!safe.valid) {
          throw new Error('URL no segura');
        }
        filePath = (await downloadUrlToTempFile(safe.url, context.handler.config.tempDirectory)).filePath;
      }

      // Process image with sharp
      const outputPath = path.join(context.handler.config.tempDirectory, `resize_${Date.now()}.png`);
      let sharpInstance = sharp(filePath);

      // Get image metadata to compute missing dimension
      const metadata = await sharpInstance.metadata();
      let finalWidth = width;
      let finalHeight = height;

      if (isNaN(finalWidth) || finalWidth <= 0) {
        // Width not provided, compute from height preserving aspect ratio
        finalWidth = Math.round((metadata.width * height) / metadata.height);
      } else if (isNaN(finalHeight) || finalHeight <= 0) {
        // Height not provided, compute from width preserving aspect ratio
        finalHeight = Math.round((metadata.height * width) / metadata.width);
      }

      // Ensure dimensions are integers
      finalWidth = Math.max(1, Math.floor(finalWidth));
      finalHeight = Math.max(1, Math.floor(finalHeight));

      sharpInstance = sharpInstance.resize(finalWidth, finalHeight);

      await sharpInstance.toFile(outputPath);

      // Send the processed image
      await context.sendTempFile(outputPath, {
        fileName: `resize_${path.basename(filePath)}`,
        mimeType: 'image/png',
        kind: 'image',
        caption: `📏 Imagen redimensionada a ${finalWidth}x${finalHeight}`
      });

      // Clean up input file
      try {
        await fs.promises.unlink(filePath);
      } catch (e) {
        // ignore
      }

      // Clear presence
      try {
        if (presenceSent && typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
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

      context.handler.logger?.warning?.('Resize processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible redimensionar la imagen. Asegúrate de que la imagen sea válida y vuelva a intentarlo.');
    }
  }
};
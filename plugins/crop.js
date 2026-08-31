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
  name: 'crop',
  aliases: [],
  description: 'Recorta una imagen: .crop [ancho] [alto] [x] [y] [url_o_responder_a_imagen]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const width = parseInt(args[0]);
    const height = parseInt(args[1]);
    const x = parseInt(args[2]);
    const y = parseInt(args[3]);
    if (isNaN(width) || width <= 0 || isNaN(height) || height <= 0) {
      await context.reply(`⚠️ Debes proporcionar ancho y alto válidos (mayores que cero).`);
      return;
    }
    // x and y are optional; if not provided, we'll compute center crop

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
      // Look for a URL in the args (skip the first four args if they are width, height, x, y)
      const urlArgs = args.slice(4).join(' ').trim();
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
      await context.reply(`⚠️ Por favor, responde a una imagen o proporciona una URL de imagen.\n\nUsa: .crop [ancho] [alto] [x] [y] [url_o_responder_a_imagen]`);
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
      const outputPath = path.join(context.handler.config.tempDirectory, `crop_${Date.now()}.png`);
      let sharpInstance = sharp(filePath);

      // Get image metadata
      const metadata = await sharpInstance.metadata();
      const imgWidth = metadata.width;
      const imgHeight = metadata.height;

      // Compute default x and y (center crop) if not provided
      let finalX = x;
      let finalY = y;
      if (isNaN(finalX) || finalX < 0) {
        finalX = Math.max(0, Math.round((imgWidth - width) / 2));
      }
      if (isNaN(finalY) || finalY < 0) {
        finalY = Math.max(0, Math.round((imgHeight - height) / 2));
      }

      // Ensure the crop area is within the image bounds
      finalX = Math.min(Math.max(0, finalX), imgWidth - width);
      finalY = Math.min(Math.max(0, finalY), imgHeight - height);

      // Ensure width and height do not exceed image bounds
      const finalWidth = Math.min(width, imgWidth - finalX);
      const finalHeight = Math.min(height, imgHeight - finalY);

      sharpInstance = sharpInstance.extract({ left: finalX, top: finalY, width: finalWidth, height: finalHeight });

      await sharpInstance.toFile(outputPath);

      // Send the processed image
      await context.sendTempFile(outputPath, {
        fileName: `crop_${path.basename(filePath)}`,
        mimeType: 'image/png',
        kind: 'image',
        caption: `✂️ Imagen recortada a ${finalWidth}x${finalHeight} (desde x:${finalX}, y:${finalY})`
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

      context.handler.logger?.warning?.('Crop processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible recortar la imagen. Asegúrate de que la imagen sea válida y vuelva a intentarlo.');
    }
  }
};
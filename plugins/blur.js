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
  name: 'blur',
  aliases: [],
  description: 'Aplica desenfoque a una imagen: .blur [radio] [url_o_responder_a_imagen]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const radius = parseFloat(args[0]) || 10; // default radius 10
    if (isNaN(radius) || radius < 0) {
      await context.reply(`⚠️ Radio de desenfoque inválido. Por favor, especifica un número no negativo.`);
      return;
    }

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
      // Look for a URL in the args (skip the first arg if it's the radius)
      const urlArgs = args.slice(1).join(' ').trim();
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
      await context.reply(`⚠️ Por favor, responde a una imagen o proporciona una URL de imagen.\n\nUsa: .blur [radio] [url_o_responder_a_imagen]`);
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
      const outputPath = path.join(context.handler.config.tempDirectory, `blur_${Date.now()}.png`);
      await sharp(filePath)
        .blur(radius)
        .toFile(outputPath);

      // Send the processed image
      await context.sendTempFile(outputPath, {
        fileName: `blur_${path.basename(filePath)}`,
        mimeType: 'image/png',
        kind: 'image',
        caption: `🌫️ Desenfoque aplicado (radio: ${radius})`
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

      context.handler.logger?.warning?.('Blur processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible aplicar el desenfoque. Asegúrate de que la imagen sea válida y vuelva a intentarlo.');
    }
  }
};
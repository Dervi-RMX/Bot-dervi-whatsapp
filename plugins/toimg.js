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
  name: 'toimg',
  aliases: [],
  description: 'Convierte un sticker a imagen: .toimg [responder_a_sticker_o_url]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
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
      const args = context.args || [];

      // Check if there is a quoted message that is a sticker
      if (context.quotedMessage &&
          detection.type === 'sticker') {
        filePath = await downloadQuotedMedia(context.quotedMessage, context.handler.config.tempDirectory);
        sourceType = 'quoted';
      }
      // Check if args contain a URL
      else if (args.length > 0) {
        const potentialUrl = args.join(' ').trim();
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
        await context.reply(`⚠️ Por favor, responde a un sticker o proporciona una URL de sticker.\n\nUsa: .toimg [responder_a_sticker_o_url]`);
        return;
      }

      // Process the sticker to image (PNG)
      const outputPath = path.join(context.handler.config.tempDirectory, `toimg_${Date.now()}.png`);
      await sharp(filePath)
        .png() // Ensure output is PNG
        .toFile(outputPath);

      // Send the processed image
      await context.sendTempFile(outputPath, {
        fileName: `converted_${path.basename(filePath, path.extname(filePath))}.png`,
        mimeType: 'image/png',
        kind: 'image',
        caption: `🖼️ Sticker convertido a imagen`
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

      context.handler.logger?.warning?.('Toimg processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible convertir el sticker a imagen. Asegúrate de que el sticker sea válido y vuelva a intentarlo.');
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
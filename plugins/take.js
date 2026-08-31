const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
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
  name: 'take',
  aliases: ['agarrar', 'capturar', 'wm'],
  description: 'Toma un sticker y permite modificar su metadata: .take [nombre del paquete] [autor] [responder a sticker o proporcionar URL]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const packName = args[0] || '';
    const authorName = args[1] || '';

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

      // Check if there is a quoted message that is a sticker
      if (context.quotedMessage &&
          detection.type === 'sticker') {
        filePath = await downloadQuotedMedia(context.quotedMessage, context.handler.config.tempDirectory);
        sourceType = 'quoted';
      }
      // Check if args contain a URL (beyond pack name and author)
      else if (args.length > 2) {
        // The URL would be in args starting from index 2
        const potentialUrl = args.slice(2).join(' ').trim();
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
        await context.reply(`⚠️ Por favor, responde a un sticker o proporciona una URL de sticker.\n\nUsa: .take [nombre del paquete] [autor] [responder a sticker o URL]\n\nEjemplo: .take MiPack MiNombre (respondiendo a un sticker)`);
        return;
      }

      // Process the sticker to add pack and author text
      const stickerBuffer = await fs.promises.readFile(filePath);

      // Get sticker dimensions
      const metadata = await sharp(stickerBuffer).metadata();
      const width = metadata.width || 512;
      const height = metadata.height || 512;

      // Create a new sticker with text overlay
      const outputPath = path.join(context.handler.config.tempDirectory, `taken_${Date.now()}.webp`);

      // Build text overlay
      const topText = packName ? packName : 'PAQUETE';
      const bottomText = authorName ? authorName : 'AUTOR';

      await sharp(stickerBuffer)
        .composite([
          {
            input: Buffer.from(
              `<svg width="${width}" height="${height}"><text x="${width/2}" y="${height/3}" text-anchor="middle" font-size="${Math.floor(height/10)}" fill="white" stroke="black" stroke-width="2">${topText}</text><text x="${width/2}" y="${height*2/3}" text-anchor="middle" font-size="${Math.floor(height/10)}" fill="white" stroke="black" stroke-width="2">${bottomText}</text></svg>`
            ),
            top: 0,
            left: 0
          }
        ])
        .webp({ quality: 80 })
        .toFile(outputPath);

      // Send the modified sticker
      await context.sendTempFile(outputPath, {
        fileName: 'taken_sticker.webp',
        mimeType: 'image/webp',
        kind: 'sticker',
        caption: `📦 Sticker tomado\nPaquete: ${packName || '(no especificado)'}\nAutor: ${authorName || '(no especificado)'}`
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

      context.handler.logger?.warning?.('Take processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible procesar el sticker. Asegúrate de que sea un sticker válido y vuelva a intentarlo.');
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
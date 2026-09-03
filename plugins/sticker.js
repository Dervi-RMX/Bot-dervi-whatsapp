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

const WISTICKERS_ANIME_URL = 'https://www.wistickers.com/anime';

function wixImageToUrl(value) {
  const match = String(value || '').match(/^wix:image:\/\/v1\/([^/#]+)/i);
  return match ? `https://static.wixstatic.com/media/${match[1]}` : null;
}

async function getRandomAnimePreview(tempDirectory) {
  const response = await fetch(WISTICKERS_ANIME_URL, {
    headers: { 'user-agent': 'BOT-SANDBOX/1.0' }
  });
  if (!response.ok) throw new Error(`WiStickers respondió ${response.status}`);

  const html = (await response.text())
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
  const previews = [];
  const pattern = /"vistaPrevia":"(wix:image:\/\/v1\/[^"]+)"[\s\S]{0,1800}?"categoria":"Anime"/gi;
  for (const match of html.matchAll(pattern)) {
    const previewUrl = wixImageToUrl(match[1]);
    if (previewUrl && !previews.includes(previewUrl)) previews.push(previewUrl);
  }
  if (!previews.length) throw new Error('No se encontraron stickers anime en WiStickers');

  const selected = previews[Math.floor(Math.random() * previews.length)];
  return downloadUrlToTempFile(selected, tempDirectory, {
    timeout: 60000,
    maxBytes: 20
  });
}

async function convertRandomPreviewToSticker(filePath) {
  const metadata = await sharp(filePath).metadata();
  const width = metadata.width || 512;
  const height = metadata.height || 512;
  const size = Math.min(width, height, 512);
  const left = width > size ? Math.floor(Math.random() * (width - size)) : 0;
  const top = height > size ? Math.floor(Math.random() * (height - size)) : 0;
  return sharp(filePath)
    .extract({ left, top, width: size, height: size })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 85 })
    .toBuffer();
}

/**
 * Converts an image to sticker format (WebP, 512x512 max)
 * @param {Buffer|string} input - Buffer or file path
 * @param {Object} options - Processing options
 * @returns {Promise<Buffer>} - Processed sticker buffer
 */
async function convertToSticker(input, options = {}) {
  let sharpInstance = sharp(input);

  // Get metadata to determine dimensions
  const metadata = await sharpInstance.metadata();
  let width = metadata.width || 512;
  let height = metadata.height || 512;

  // Limit to 512x512 while preserving aspect ratio
  const maxSize = 512;
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // Ensure dimensions are even (required for WebP)
  width = width - (width % 2);
  height = height - (height % 2);

  // Convert to WebP with sticker settings
  return sharpInstance
    .resize(width, height, { fit: 'inside' })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Extracts first frame from video/GIF and converts to sticker
 * @param {string} filePath - Path to video/GIF file
 * @returns {Promise<Buffer>} - Sticker buffer
 */
async function extractFirstFrameToSticker(filePath) {
  // First, try to get a single frame using ffmpeg if available
  // For now, we'll use a simpler approach: treat as image and let sharp handle it
  // sharp can read some video formats but it's limited

  // Try to process directly with sharp (works for some formats)
  try {
    return await convertToSticker(filePath);
  } catch (sharpError) {
    // If sharp fails, we might need ffmpeg to extract frame
    // For now, fall back to creating a basic sticker from first frame concept
    // In a production environment, you'd use ffmpeg here
    throw new Error(`Unable to process video/GIF: ${sharpError.message}. FFmpeg support needed for video processing.`);
  }
}

module.exports = {
  name: 'sticker',
  aliases: ['pega', 'pegatina', 'emoji'],
  description: 'Genera stickers: .sticker [texto] | .sticker [imagen/video/GIF/url] (responde a media o proporciona URL)',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const query = args.join(' ').trim();

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
      let isFromUrl = false;

      // Determine source: quoted message, URL in args, or text for emoji sticker
      const detection = context.currentDetection || detectMessageContent(context.message);

      // Check if there is a quoted message that is media
      if (context.quotedMessage &&
          ['image', 'video', 'sticker'].includes(detection.type)) {
        filePath = await downloadQuotedMedia(context.quotedMessage, context.handler.config.tempDirectory);
        sourceType = 'quoted';
      }
      // Check if args contain a URL
      else if (args.length > 0) {
        // Join args and check if it's a URL
        const potentialUrl = args.join(' ').trim();
        if (isUrl(potentialUrl)) {
          const safe = await validateSafeUrl(potentialUrl);
          if (!safe.valid) {
            throw new Error('URL no segura');
          }
          filePath = (await downloadUrlToTempFile(safe.url, context.handler.config.tempDirectory)).filePath;
          sourceType = 'url';
          isFromUrl = true;
        }
        // If not a URL, treat as text for emoji sticker (existing behavior)
        else {
          // Fall back to original emoji-based sticker logic
          const texto = query;
          if (!texto.trim()) {
            await context.reply(`⚠️ Usa: .sticker <texto> o responde a una imagen/video/GIF\n\nEjemplos:\n• .sticker feliz\n• .sticker gracias\n• .sticker amor\n• .sticker (respondiendo a un mensaje)`);
            return;
          }

          // Original emoji-based sticker logic (simplified)
          const EMOJIS_DISPONIBLES = [
            '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊',
            '😋', '😎', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛',
            '😜', '🤪', '🤨', '😢', '😭', '😓', '😰', '😪', '😫', '😌',
            '😴', '🤔', '😤', '😠', '😡', '😒', '😓', '😔', '😖', '😞',
            '😟', '😠', '😤', '😥', '😩', '😨', '😰', '😱', '😲', '😳',
            '😵', '😶', '😷', '🤒', '🤕', '🤖', '🤠', '🤡', '🤥', '😈',
            '👿', '👹', '👺', '💀', '💩', '☹️', '🙁', '😦', '😧', '😮',
            '😯', '😪', '😴', '😪', '🤤', '😪', '😵', '💫', '💫'
          ];

          const COLORS_DISPONIBLES = [
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💔', '💘',
            '👍', '👎', '✅', '❌', '❤️‍🔥', '🎉', '🌟', '⭐', '🏆'
          ];

          function obtenerEmojiAleatorio() {
            return EMOJIS_DISPONIBLES[Math.floor(Math.random() * EMOJIS_DISPONIBLES.length)];
          }

          function obtenerEmojiPorTexto(texto) {
            const bajo = texto.toLowerCase().trim();
            const mapas = {
              'feliz': '😀', 'contento': '😀', 'j': '😀',
              'triste': '😢', 'depresión': '😢', 'sad': '😢',
              'enojado': '😠', 'ira': '😠', 'angry': '😠',
              'risa': '😂', 'jajaja': '😂', 'haha': '😂',
              'sorpresa': '😮', 'wow': '😮', 'oh': '😮',
              'hola': '👋', 'hello': '👋',
              'gracias': '🙏', 'thank': '🙏',
              'amor': '❤️', 'love': '❤️',
              'fuego': '🔥', 'fire': '🔥',
              'corazón': '❤️', 'heart': '❤️',
              'estrella': '⭐', 'star': '⭐',
              ' musica': '🎵', 'music': '🎵',
              'comida': '🍕', 'eat': '🍴',
              'dormir': '😴', 'sleep': '😴',
              'lol': '😂', 'rofl': '😂', 'lmao': '🤣'
            };

            for (const [palabra, emoji] of Object.entries(mapas)) {
              if (bajo.includes(palabra)) {
                return { emoji, tipo: 'mapeado' };
              }
            }

            return { emoji: obtenerEmojiAleatorio(), tipo: 'aleatorio' };
          }

          function crearDescripcionSticker(texto) {
            let emoji;
            if (texto && texto.trim()) {
              const resultado = obtenerEmojiPorTexto(texto);
              emoji = resultado.emoji;
            } else {
              emoji = obtenerEmojiAleatorio();
            }

            const partes = [emoji];
            if (texto && texto.trim()) {
              const textoResp = texto.trim().slice(0, 20);
              partes.push(textoResp);
            }

            if (!EMOJIS_DISPONIBLES.includes(emoji)) {
              partes.unshift(COLORS_DISPONIBLES[Math.floor(Math.random() * COLORS_DISPONIBLES.length)]);
            }

            return partes.join(' ');
          }

          async function enviarStickerSimple(context, emoji, texto) {
            const descripcion = crearDescripcionSticker(texto);
            try {
              const caption = `🎨 ${descripcion}`;
              await context.reply(caption);
            } catch (error) {
              try {
                await context.reply(`🎨 ${emoji}`);
              } catch (e) {
                await context.reply(emoji);
              }
            }
          }

          const resultado = obtenerEmojiPorTexto(texto);
          await enviarStickerSimple(context, resultado.emoji, texto);
          return;
        }
      }
      // With no arguments, send a random anime sticker from WiStickers.
      else {
        const download = await getRandomAnimePreview(context.handler.config.tempDirectory);
        filePath = download.filePath;
        sourceType = 'wistickers';
      }

      // Process the media file to create a sticker
      if (filePath) {
        let stickerBuffer;

        try {
          // Crop a random tile from WiStickers previews; regular media uses normal conversion.
          stickerBuffer = sourceType === 'wistickers'
            ? await convertRandomPreviewToSticker(filePath)
            : await convertToSticker(filePath);
        } catch (convertError) {
          // If direct conversion fails, try to extract frame from video/GIF
          try {
            stickerBuffer = sourceType === 'wistickers'
              ? await convertRandomPreviewToSticker(filePath)
              : await extractFirstFrameToSticker(filePath);
          } catch (frameError) {
            // If both fail, provide helpful error message
            throw new Error(`No se pudo convertir el media a sticker. Asegúrate de que sea una imagen, video o GIF válido.`);
          }
        }

        // Send the sticker
        const outputPath = path.join(context.handler.config.tempDirectory, `sticker_${Date.now()}.webp`);
        await fs.promises.writeFile(outputPath, stickerBuffer);

        await context.sendTempFile(outputPath, {
          fileName: 'sticker.webp',
          mimeType: 'image/webp',
          kind: 'sticker',
          caption: `🎨 Sticker generado${sourceType === 'wistickers' ? ' aleatoriamente de WiStickers Anime' : sourceType === 'url' ? ' de URL' : ''}`
        });

        // Clean up input file
        try {
          await fs.promises.unlink(filePath);
        } catch (e) {
          // ignore
        }
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

      context.handler.logger?.warning?.('Sticker processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible generar el sticker. Asegúrate de que el media sea válido y vuelva a intentarlo.');
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
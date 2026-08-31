const { getQuotedMessage, getQuotedType, getMessageContent, getContentType, getMessageText, extractUrls, isQuotedMessage } = require('../lib/utils');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { validateSafeUrl } = require('../lib/utils');
const fs = require('fs');
const sharp = require('sharp');
// Import vision functions
const { requestOpenAIVision, requestGeminiVision, prepareImageForVision } = require('./vision');

function isUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Function to convert image to base64 for AI vision models
async function imageToBase64(imageBuffer) {
  return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
}

module.exports = {
  name: 'ocr',
  aliases: ['texto', 'extraer'],
  description: 'Extrae texto de imágenes usando OCR: .ocr [responder_a_imagen_o_url]',
  async execute(context) {
    const config = context.handler.config || {};

    // Get image from quoted message or URL in args
    let imageBuffer = null;
    let imageSource = '';

    // Check if there is a quoted message that is an image
    if (isQuotedMessage(context.message)) {
      const detection = detectMessageContent(context.quotedMessage || context.message);
      if (['image', 'sticker'].includes(detection.type)) {
        try {
          imageBuffer = await downloadQuotedMedia(context.quotedMessage, context.handler.config.tempDirectory);
          imageSource = 'mensaje citado';
        } catch (error) {
          // Continue to check URL
        }
      }
    }

    // If no quoted image, check for URL in args
    if (!imageBuffer && (context.args || []).length > 0) {
      const urlArgs = (context.args || []).join(' ').trim();
      const urls = extractUrls(urlArgs);
      const validUrl = urls.find(u => validateSafeUrl(u).valid);

      if (validUrl) {
        try {
          const safe = validateSafeUrl(validUrl);
          const downloadResult = await downloadUrlToTempFile(safe.url, context.handler.config.tempDirectory, {
            maxBytes: 50, // 50MB limit for images
            timeout: 30000
          });
          imageBuffer = await fs.promises.readFile(downloadResult.filePath);
          imageSource = 'URL';

          // Clean up the downloaded file
          try {
            await fs.promises.unlink(downloadResult.filePath);
          } catch (e) {
            // ignore
          }
        } catch (error) {
          // Continue to error handling
        }
      }
    }

    if (!imageBuffer) {
      await context.reply(`⚠️ Por favor, responde a una imagen o proporciona una URL de imagen.\n\nUsa: .ocr [responder_a_imagen_o_url]\n\nEjemplos:\n• .ocr (respondiendo a una foto con texto)\n• .ocr https://ejemplo.com/imagen-con-texto.jpg`);
      return;
    }

    // Determine which AI provider to use for OCR
    const hasOpenAI = Boolean(String(config.openAiApiKey || '').trim());
    const hasGemini = Boolean(String(config.geminiApiKey || '').trim());

    if (!hasOpenAI && !hasGemini) {
      await context.reply('⚠️ No hay proveedores de IA configurados para OCR. Necesitas OPENAI_API_KEY o GEMINI_API_KEY en .env.');
      return;
    }

    // Show processing indicator
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
      // Try providers in order: prefer Gemini for OCR as it's often strong, then OpenAI
      const providers = [];
      if (hasGemini) providers.push({ name: 'Gemini', request: requestGeminiVision });
      if (hasOpenAI) providers.push({ name: 'OpenAI (GPT-4V)', request: requestOpenAIVision });

      let lastError = null;
      for (const provider of providers) {
        try {
          // Use a specific prompt for OCR
          const prompt = 'Extrae todo el texto de esta imagen. Devuelve solo el texto reconocido, sin comentarios adicionales. Si no hay texto, indica que no se encontró texto.';
          const answer = await provider.request(prompt, imageBuffer, config);

          // Clear presence
          try {
            if (presenceSent && typeof context.client.sendPresenceUpdate === 'function') {
              await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
              await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
            }
          } catch (e) {
            // ignore
          }

          await context.reply(`📄 ${provider.name} - OCR\n\n${answer}`);
          return;
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

          lastError = error;
          context.handler.logger?.warning?.(`${provider.name} OCR request failed`, {
            error: error.message
          });

          // Continue to next provider
        }
      }

      // If all providers failed
      if (presenceSent && typeof context.client.sendPresenceUpdate === 'function') {
        await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
        await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
      }

      await context.reply(`⚠️ No se pudo extraer el texto de la imagen con ningún proveedor de IA. ${lastError?.message || 'Error desconocido'}`);
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

      context.handler.logger?.warning?.('OCR processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible procesar la imagen para OCR. Asegúrate de que sea una imagen válida y vuelva a intentarlo.');
    }
  }
};

// Helper function to detect message content (same as in content-detector.js but simplified for this plugin)
function detectMessageContent(message) {
  if (isQuotedMessage(message)) {
    const quoted = getQuotedMessage(message);
    const quotedType = getQuotedType(message);
    const quotedText = getMessageText({ message: quoted });
    const urls = extractUrls(quotedText);

    if (quotedType && ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].has(quotedType)) {
      const media = quoted[quotedType];
      return {
        type: quotedType.replace('Message', '').toLowerCase(),
        source: 'quoted-message',
        url: media?.url || null,
        message: quoted,
        text: quotedText,
        mimeType: media?.mimetype || media?.mimeType || null,
        fileName: media?.fileName || null
      };
    }

    if (urls.length) {
      return {
        type: 'url',
        source: 'quoted-message',
        url: urls[0],
        message: quoted,
        text: quotedText
      };
    }

    return {
      type: 'text',
      source: 'quoted-message',
      url: null,
      message: quoted,
      text: quotedText
    };
  }

  // Detect from current message
  const type = getContentType(message);
  const content = getMessageContent(message);
  const text = getMessageText(message);
  const urls = extractUrls(text);

  if (type && ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].has(type)) {
    const media = content[type];
    return {
      type: type.replace('Message', '').toLowerCase(),
      source: 'current-message',
      url: media?.url || null,
      message,
      text,
      mimeType: media?.mimetype || media?.mimeType || null,
      fileName: media?.fileName || null
    };
  }

  if (urls.length) {
    return {
      type: 'url',
      source: 'current-message',
      url: urls[0],
      message,
      text
    };
  }

  if (text) {
    return {
      type: 'text',
      source: 'current-message',
      url: null,
      message,
      text
    };
  }

  return {
    type: 'unknown',
    source: 'current-message',
    url: null,
    message,
    text: ''
  };
}
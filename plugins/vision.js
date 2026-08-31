const fs = require('fs');
const path = require('path');
const { getQuotedMessage, getQuotedType, getMessageContent, getContentType, getMessageText, extractUrls, isQuotedMessage } = require('../lib/utils');
const { getPrompt } = require('./chatgpt');
const { requestChatGpt } = require('./chatgpt');
const { requestGemini } = require('./gemini');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { validateSafeUrl } = require('../lib/utils');
const sharp = require('sharp');

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

// Function to process and optimize image for vision models
async function prepareImageForVision(imageBuffer) {
  try {
    // Optimize image: resize if too large, convert to JPEG, reasonable quality
    const optimized = await sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF
      .resize(1024, 1024, { fit: 'inside' }) // Limit dimensions
      .jpeg({ quality: 85 })
      .toBuffer();

    return await imageToBase64(optimized);
  } catch (error) {
    // Fallback to original if optimization fails
    return await imageToBase64(imageBuffer);
  }
}

// Vision-enabled request builder for OpenAI (GPT-4V/GPT-4o)
function buildOpenAIVisionRequestBody(prompt, imageBase64, config = {}) {
  return {
    model: String(config.openAiModel || 'gpt-4o-mini'),
    messages: [
      { role: 'system', content: 'Eres un asistente útil especializado en análisis de imágenes. Responde en español, salvo que la persona solicite otro idioma.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: imageBase64,
              detail: 'high' // or 'low' for lower cost, less detail
            }
          }
        ]
      }
    ],
    max_tokens: Number(config.openAiMaxOutputTokens) > 0
      ? Number(config.openAiMaxOutputTokens)
      : 800,
    temperature: 0.7
  };
}

// Vision-enabled request builder for Gemini
function buildGeminiVisionRequestBody(prompt, imageBase64, config = {}) {
  return {
    model: String(config.geminiModel || 'gemini-2.0-flash'),
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: imageBase64.split(',')[1] // Remove the data:image/jpeg;base64 prefix
            }
          }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: Number(config.geminiMaxOutputTokens) > 0
        ? Number(config.geminiMaxOutputTokens)
        : 800,
      temperature: 0.7
    }
  };
}

async function requestOpenAIVision(prompt, imageBuffer, config = {}) {
  const apiKey = String(config.openAiApiKey || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada.');

  const timeoutMs = Number(config.openAiTimeoutMs) > 0
    ? Number(config.openAiTimeoutMs)
    : 45000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const imageBase64 = await prepareImageForVision(imageBuffer);
    const requestBody = buildOpenAIVisionRequestBody(prompt, imageBase64, config);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const status = Number(response.status) || 0;
      const code = status === 401
        ? 'invalid_api_key'
        : status === 429
          ? 'rate_limited'
          : 'api_error';
      throw new Error(`OpenAI respondió con HTTP ${status}: ${payload?.error?.message || 'Error desconocido'}`);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') throw new Error('OpenAI no devolvió una respuesta de texto válida.');
    return content.trim();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La solicitud a OpenAI agotó el tiempo de espera.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestGeminiVision(prompt, imageBuffer, config = {}) {
  const apiKey = String(config.geminiApiKey || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY no está configurada.');

  const timeoutMs = Number(config.geminiTimeoutMs) > 0
    ? Number(config.geminiTimeoutMs)
    : 45000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const imageBase64 = await prepareImageForVision(imageBuffer);
    const requestBody = buildGeminiVisionRequestBody(prompt, imageBase64, config);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel || 'gemini-2.0-flash')}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const status = Number(response.status) || 0;
      const apiMessage = String(payload?.error?.message || '');
      const code = status === 401 || status === 403
        || /api\s*key|api_key/i.test(apiMessage)
        ? 'invalid_api_key'
        : status === 429
          ? 'rate_limited'
          : 'api_error';
      throw new Error(`Gemini respondió con HTTP ${status}: ${apiMessage || 'Error desconocido'}`);
    }

    const feedbackReason = payload?.promptFeedback?.blockReason;
    if (feedbackReason) throw new Error(`Gemini bloqueó la respuesta por sus filtros de seguridad: ${feedbackReason}`);

    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new Error('Gemini no devolvió partes de contenido válidas.');

    const content = parts
      .map(part => typeof part?.text === 'string' ? part.text : '')
      .join('\n')
      .trim();

    if (!content) throw new Error('Gemini no devolvió una respuesta de texto.');
    return content;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La solicitud a Gemini agotó el tiempo de espera.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Export functions for reuse
module.exports = {
  name: 'vision',
  aliases: ['analizar', 'imagen'],
  description: 'Analiza imágenes usando IA de visión: .vision [pregunta] [responder_a_imagen_o_url]',
  async execute(context) {
    const config = context.handler.config || {};

    // Get prompt from args (optional)
    const args = context.args || [];
    const prompt = args.length > 0 ? args.join(' ') : 'Describe lo que ves en esta imagen con detalle.';

    // Get image from quoted message or URL in args
    let imageBuffer = null;
    let imageSource = '';

    // Check if there is a quoted message that is an image
    const detection = isQuotedMessage(context.message) ?
      detectMessageContent(context.quotedMessage || context.message) :
      detectMessageContent(context.message);

    if (isQuotedMessage(context.message) &&
        ['image', 'sticker'].includes(detection.type)) {
      try {
        imageBuffer = await downloadQuotedMedia(context.quotedMessage, context.handler.config.tempDirectory);
        imageSource = 'mensaje citado';
      } catch (error) {
        // Continue to check URL
      }
    }

    // If no quoted image, check for URL in args
    if (!imageBuffer && args.length > 0) {
      // Look for URL in args (could be anywhere, but let's check all args)
      const urlArgs = args.join(' ').trim();
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
      await context.reply(`⚠️ Por favor, responde a una imagen o proporciona una URL de imagen.\n\nUsa: .vision [pregunta] [responder_a_imagen_o_url]\n\nEjemplos:\n• .vision ¿Qué hay en esta imagen? (respondiendo a una foto)\n• .vision Lee el texto en esta imagen https://ejemplo.com/imagen.jpg\n• .vision (respondiendo a una imagen para descripción general)`);
      return;
    }

    // Determine which AI provider to use for vision
    const hasOpenAI = Boolean(String(config.openAiApiKey || '').trim());
    const hasGemini = Boolean(String(config.geminiApiKey || '').trim());

    if (!hasOpenAI && !hasGemini) {
      await context.reply('⚠️ No hay proveedores de IA configurados para visión. Necesitas OPENAI_API_KEY o GEMINI_API_KEY en .env.');
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
      // Try providers in order: prefer Gemini for vision as it's often strong, then OpenAI
      const providers = [];
      if (hasGemini) providers.push({ name: 'Gemini', request: requestGeminiVision });
      if (hasOpenAI) providers.push({ name: 'OpenAI (GPT-4V)', request: requestOpenAIVision });

      let lastError = null;
      for (const provider of providers) {
        try {
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

          await context.reply(`👁️ ${provider.name}\n\n${answer}`);
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
          context.handler.logger?.warning?.(`${provider.name} vision request failed`, {
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

      await context.reply(`⚠️ No se pudo analizar la imagen con ningún proveedor de IA. ${lastError?.message || 'Error desconocido'}`);
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

      context.handler.logger?.warning?.('Vision processing failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible procesar la imagen para visión. Asegúrate de que sea una imagen válida y vuelva a intentarlo.');
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

// Exported functions for reuse in other plugins
module.exports.requestOpenAIVision = requestOpenAIVision;
module.exports.requestGeminiVision = requestGeminiVision;
module.exports.prepareImageForVision = prepareImageForVision;
module.exports.imageToBase64 = imageToBase64;
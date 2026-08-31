const fs = require('fs');
const path = require('path');
const { getPrompt } = require('./chatgpt');
const { downloadUrlToTempFile } = require('../lib/downloader');
const { validateSafeUrl } = require('../lib/utils');

function isUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Function to call OpenAI Images API (DALL-E)
async function requestOpenAIImage(prompt, config = {}) {
  const apiKey = String(config.openAiApiKey || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada.');

  // Determine model: if openAiModel looks like dall-e, use it; else default to dall-e-3
  const model = String(config.openAiModel || '').trim();
  const useModel = model && (model.startsWith('dall-e') || model.startsWith('dall_e')) ? model : 'dall-e-3';

  const timeoutMs = Number(config.openAiTimeoutMs) > 0
    ? Number(config.openAiTimeoutMs)
    : 45000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.openai.com/v1/images/generate', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt,
        model: useModel,
        n: 1,
        size: '1024x1024', // configurable? we can keep fixed
        response_format: 'url' // we get URL to download
      }),
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
      throw new Error(`OpenAI Images respondió con HTTP ${status}: ${payload?.error?.message || 'Error desconocido'}`);
    }

    const imageUrl = payload?.data?.[0]?.url;
    if (!imageUrl || typeof imageUrl !== 'string') throw new Error('OpenAI no devolvió una URL de imagen.');
    return imageUrl;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La solicitud a OpenAI Images agotó el tiempo de espera.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  name: 'imagine',
  aliases: ['img', 'generar'],
  description: 'Genera imágenes usando IA (DALL-E): .imagine <descripción>',
  async execute(context) {
    const config = context.handler.config || {};

    // Get prompt from args
    const prompt = getPrompt(context);
    if (!prompt) {
      await context.reply(`⚠️ Usa: ${context.prefix}imagine <descripción>\nEjemplo: .imagine un gato astronauta en Marte`);
      return;
    }

    // Check if OpenAI is configured
    const hasOpenAI = Boolean(String(config.openAiApiKey || '').trim());
    if (!hasOpenAI) {
      await context.reply('⚠️ La función de generación de imágenes requiere OPENAI_API_KEY configurada en .env (usa modelos DALL-E).');
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

    let imageBuffer = null;
    let tempFilePath = null;
    try {
      // Get image URL from OpenAI
      const imageUrl = await requestOpenAIImage(prompt, config);

      // Download the image to a temporary file
      const safe = validateSafeUrl(imageUrl);
      const downloadResult = await downloadUrlToTempFile(safe.url, config.tempDirectory, {
        maxBytes: 20, // 20MB limit for generated images
        timeout: 30000
      });
      tempFilePath = downloadResult.filePath;
      imageBuffer = await fs.promises.readFile(tempFilePath);

      // Send the generated image
      await context.sendTempFile(tempFilePath, {
        fileName: `imagine_${Date.now()}.png`,
        mimeType: 'image/png',
        kind: 'image',
        caption: `🎨 Imagen generada por IA\nPrompt: ${prompt}`
      });

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

      context.handler.logger?.warning?.('Imagine processing failed', { error: error?.message || String(error) });
      await context.reply(`⚠️ No se pudo generar la imagen. ${error?.message || 'Error desconocido'}`);
    } finally {
      // Clean up temporary file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (e) {
          // ignore
        }
      }
    }
  }
};
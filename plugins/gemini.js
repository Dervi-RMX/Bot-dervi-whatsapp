const { getPrompt, formatAnswer } = require('./chatgpt');
const { normalizeText } = require('../lib/utils');

// Gemini responses can be longer, increase the limit
const GEMINI_MAX_RESPONSE_LENGTH = 8000;

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const DEFAULT_MAX_PROMPT_LENGTH = 4000;
const DEFAULT_TIMEOUT_MS = 45_000;
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const SYSTEM_PROMPT = 'Eres un asistente útil. Responde en español, salvo que la persona solicite otro idioma.';

function buildEndpoint(model = DEFAULT_MODEL) {
  const selectedModel = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return `${GEMINI_ENDPOINT}/${encodeURIComponent(selectedModel)}:generateContent`;
}

function buildRequestBody(prompt, config = {}) {
  const maxOutputTokens = Number(config.geminiMaxOutputTokens) > 0
    ? Number(config.geminiMaxOutputTokens)
    : DEFAULT_MAX_OUTPUT_TOKENS;
  return {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: { maxOutputTokens }
  };
}

function extractResponseContent(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return normalizeText(parts
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('\n'));
}

function getBlockReason(payload) {
  const feedbackReason = payload?.promptFeedback?.blockReason;
  if (feedbackReason) return String(feedbackReason);
  return payload?.candidates?.[0]?.finishReason === 'SAFETY' ? 'SAFETY' : '';
}

function createError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function requestGemini(prompt, config = {}) {
  const apiKey = String(config.geminiApiKey || '').trim();
  if (!apiKey) throw createError('missing_api_key', 'GEMINI_API_KEY no está configurada.');

  const timeoutMs = Number(config.geminiTimeoutMs) > 0
    ? Number(config.geminiTimeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildEndpoint(config.geminiModel), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(buildRequestBody(prompt, config)),
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
      const code = status === 401
        || status === 403
        || /api\s*key|api_key/i.test(apiMessage)
        ? 'invalid_api_key'
        : status === 429
          ? 'rate_limited'
          : 'api_error';
      throw createError(code, apiMessage || `Gemini respondió con HTTP ${status}.`, status);
    }

    const blockReason = getBlockReason(payload);
    if (blockReason) throw createError('blocked', blockReason);

    const content = extractResponseContent(payload);
    if (!content) throw createError('empty_response', 'Gemini no devolvió texto.');
    return content;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createError('timeout', 'La solicitud a Gemini agotó el tiempo de espera.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function formatGeminiAnswer(answer) {
  const text = normalizeText(answer);
  if (text.length <= GEMINI_MAX_RESPONSE_LENGTH) return text;
  return `${text.slice(0, GEMINI_MAX_RESPONSE_LENGTH - 1).trimEnd()}…`;
}

function userFacingError(error) {
  switch (error?.code) {
    case 'missing_api_key':
      return '⚠️ El comando Gemini no está configurado. Falta GEMINI_API_KEY en el archivo .env.';
    case 'invalid_api_key':
      return '⚠️ La API key de Gemini no es válida. Revisa GEMINI_API_KEY en .env.';
    case 'rate_limited':
      return '⚠️ Gemini rechazó temporalmente la solicitud por límite de uso. Intenta más tarde.';
    case 'blocked':
      return '⚠️ Gemini bloqueó la respuesta por sus filtros de seguridad. Prueba con otra pregunta.';
    case 'timeout':
      return '⚠️ Gemini tardó demasiado en responder. Intenta nuevamente.';
    case 'empty_response':
      return '⚠️ Gemini no devolvió una respuesta de texto.';
    default:
      return '⚠️ No pude obtener una respuesta de Gemini en este momento.';
  }
}

module.exports = {
  name: 'gemini',
  aliases: ['googleai'],
  description: 'Consulta Google Gemini sin guardar historial de conversación',
  buildEndpoint,
  buildRequestBody,
  extractResponseContent,
  getBlockReason,
  requestGemini,
  async execute(context) {
    const config = context.handler.config || {};
    const maxPromptLength = Number(config.geminiMaxPromptLength) > 0
      ? Number(config.geminiMaxPromptLength)
      : DEFAULT_MAX_PROMPT_LENGTH;
    const prompt = getPrompt(context, maxPromptLength);

    if (!prompt) {
      await context.reply(`⚠️ Usa: ${context.prefix}gemini <pregunta>\nTambién puedes responder a un mensaje y escribir ${context.prefix}gemini`);
      return;
    }

    try {
      const answer = await requestGemini(prompt, config);
      await context.reply(`✨ Gemini\n\n${formatGeminiAnswer(answer)}`);
    } catch (error) {
      context.handler.logger?.warning?.('Gemini request failed', {
        code: error?.code || 'unknown',
        status: error?.status || 0
      });
      await context.reply(userFacingError(error));
    }
  }
};

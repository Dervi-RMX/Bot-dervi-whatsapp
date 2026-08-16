const { getMessageText, normalizeText } = require('../lib/utils');

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const DEFAULT_MAX_PROMPT_LENGTH = 4000;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_LENGTH = 6000;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const SYSTEM_PROMPT = 'Eres un asistente útil. Responde en español, salvo que la persona solicite otro idioma.';

function limitText(value, maxLength) {
  const limit = Number.isSafeInteger(Number(maxLength)) && Number(maxLength) > 0
    ? Number(maxLength)
    : DEFAULT_MAX_PROMPT_LENGTH;
  return normalizeText(value).slice(0, limit);
}

function getPrompt(context, maxLength = DEFAULT_MAX_PROMPT_LENGTH) {
  const typedPrompt = limitText((context?.args || []).join(' '), maxLength);
  if (typedPrompt) return typedPrompt;
  return limitText(getMessageText(context?.quotedMessage), maxLength);
}

function buildRequestBody(prompt, config = {}) {
  return {
    model: String(config.openAiModel || DEFAULT_MODEL),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    max_tokens: Number(config.openAiMaxOutputTokens) > 0
      ? Number(config.openAiMaxOutputTokens)
      : DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: 0.7
  };
}

function extractResponseContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return normalizeText(content);
  if (Array.isArray(content)) {
    return normalizeText(content
      .map(part => typeof part === 'string' ? part : part?.text || '')
      .join(' '));
  }
  return '';
}

function createError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function requestChatGpt(prompt, config = {}) {
  const apiKey = String(config.openAiApiKey || '').trim();
  if (!apiKey) throw createError('missing_api_key', 'OPENAI_API_KEY no está configurada.');

  const timeoutMs = Number(config.openAiTimeoutMs) > 0
    ? Number(config.openAiTimeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
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
      const code = status === 401
        ? 'invalid_api_key'
        : status === 429
          ? 'rate_limited'
          : 'api_error';
      throw createError(code, payload?.error?.message || `OpenAI respondió con HTTP ${status}.`, status);
    }

    const content = extractResponseContent(payload);
    if (!content) throw createError('empty_response', 'OpenAI no devolvió texto.');
    return content;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createError('timeout', 'La solicitud a OpenAI agotó el tiempo de espera.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function formatAnswer(answer) {
  const text = normalizeText(answer);
  if (text.length <= MAX_RESPONSE_LENGTH) return text;
  return `${text.slice(0, MAX_RESPONSE_LENGTH - 1).trimEnd()}…`;
}

function userFacingError(error) {
  switch (error?.code) {
    case 'missing_api_key':
      return '⚠️ El comando ChatGPT no está configurado. Falta OPENAI_API_KEY en el archivo .env.';
    case 'invalid_api_key':
      return '⚠️ La API key de OpenAI no es válida. Revisa OPENAI_API_KEY en .env.';
    case 'rate_limited':
      return '⚠️ OpenAI rechazó temporalmente la solicitud por límite de uso. Intenta más tarde.';
    case 'timeout':
      return '⚠️ OpenAI tardó demasiado en responder. Intenta nuevamente.';
    case 'empty_response':
      return '⚠️ OpenAI no devolvió una respuesta de texto.';
    default:
      return '⚠️ No pude obtener una respuesta de ChatGPT en este momento.';
  }
}

module.exports = {
  name: 'chatgpt',
  aliases: ['gpt'],
  description: 'Consulta ChatGPT sin guardar historial de conversación',
  limitText,
  getPrompt,
  buildRequestBody,
  extractResponseContent,
  formatAnswer,
  requestChatGpt,
  async execute(context) {
    const config = context.handler.config || {};
    const maxPromptLength = Number(config.openAiMaxPromptLength) > 0
      ? Number(config.openAiMaxPromptLength)
      : DEFAULT_MAX_PROMPT_LENGTH;
    const prompt = getPrompt(context, maxPromptLength);

    if (!prompt) {
      await context.reply(`⚠️ Usa: ${context.prefix}chatgpt <pregunta>\nTambién puedes responder a un mensaje y escribir ${context.prefix}chatgpt`);
      return;
    }

    try {
      const answer = await requestChatGpt(prompt, config);
      await context.reply(`🤖 ChatGPT\n\n${formatAnswer(answer)}`);
    } catch (error) {
      context.handler.logger?.warning?.('ChatGPT request failed', {
        code: error?.code || 'unknown',
        status: error?.status || 0
      });
      await context.reply(userFacingError(error));
    }
  }
};

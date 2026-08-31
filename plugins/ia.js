const { getPrompt, formatAnswer } = require('./chatgpt');
const { requestChatGpt, userFacingError: chatgptUserFacingError } = require('./chatgpt');
const { requestGemini, userFacingError: geminiUserFacingError } = require('./gemini');
const { normalizeText } = require('../lib/utils');

const DEFAULT_MAX_RESPONSE_LENGTH = 6000;
const GEMINI_MAX_RESPONSE_LENGTH = 8000;

module.exports = {
  name: 'ia',
  aliases: ['inteligencia', 'ai'],
  description: 'Consulta IA con fallback entre proveedores: .ia <pregunta>',
  async execute(context) {
    const config = context.handler.config || {};

    // Get prompt from args or quoted message
    const prompt = getPrompt(context);

    if (!prompt) {
      await context.reply(`⚠️ Usa: ${context.prefix}ia <pregunta>\nTambién puedes responder a un mensaje y escribir ${context.prefix}ia`);
      return;
    }

    // Determine which AI provider to use as primary
    const hasOpenAI = Boolean(String(config.openAiApiKey || '').trim());
    const hasGemini = Boolean(String(config.geminiApiKey || '').trim());

    if (!hasOpenAI && !hasGemini) {
      await context.reply('⚠️ No hay proveedores de IA configurados. Configure OPENAI_API_KEY o GEMINI_API_KEY en .env.');
      return;
    }

    // Try primary provider first, then fallback
    const providers = [];
    if (hasOpenAI) providers.push({ name: 'OpenAI', request: requestChatGpt, formatError: chatgptUserFacingError, formatAnswer });
    if (hasGemini) providers.push({ name: 'Gemini', request: requestGemini, formatError: geminiUserFacingError, formatAnswer: (answer) => {
      const text = normalizeText(answer);
      if (text.length <= GEMINI_MAX_RESPONSE_LENGTH) return text;
      return `${text.slice(0, GEMINI_MAX_RESPONSE_LENGTH - 1).trimEnd()}…`;
    }});

    // If user specified a preference in the command, try to honor it
    const args = context.args || [];
    if (args.length > 0) {
      const firstArg = args[0].toLowerCase();
      if (firstArg === 'chatgpt' || firstArg === 'gpt') {
        // Move OpenAI to first position if available
        const openaiIndex = providers.findIndex(p => p.name === 'OpenAI');
        if (openaiIndex > 0) {
          const [openai] = providers.splice(openaiIndex, 1);
          providers.unshift(openai);
        }
      } else if (firstArg === 'gemini' || firstArg === 'googleai') {
        // Move Gemini to first position if available
        const geminiIndex = providers.findIndex(p => p.name === 'Gemini');
        if (geminiIndex > 0) {
          const [gemini] = providers.splice(geminiIndex, 1);
          providers.unshift(gemini);
        }
      }
    }

    // Try each provider in order until one succeeds
    let lastError = null;
    for (const provider of providers) {
      try {
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

        const answer = await provider.request(prompt, config);

        // Clear presence
        try {
          if (presenceSent && typeof context.client.sendPresenceUpdate === 'function') {
            await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
            await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
          }
        } catch (e) {
          // ignore
        }

        // Send response with provider attribution
        await context.reply(`🤖 ${provider.name}\n\n${provider.formatAnswer(answer)}`);
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
        context.handler.logger?.warning?.(`${provider.name} request failed`, {
          code: error.code || 'unknown',
          status: error.status || 0
        });

        // Continue to next provider unless it's a critical error that shouldn't trigger fallback
        const shouldFallback = !(error.code === 'missing_api_key' || error.code === 'invalid_api_key');
        if (!shouldFallback) {
          // Don't fallback on auth errors - show the error directly
          await context.reply(provider.formatError(error));
          return;
        }
        // Otherwise, continue to next provider
      }
    }

    // If all providers failed, show the last error
    if (lastError) {
      // Determine which provider failed last for appropriate error message
      const lastProvider = providers[providers.length - 1] || {};
      await context.reply(lastProvider.formatError ? lastProvider.formatError(lastError) : '⚠️ No se pudo obtener respuesta de ningún proveedor de IA.');
    }
  }
};
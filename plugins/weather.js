const { detectMessageContent } = require('../lib/content-detector');

module.exports = {
  name: 'weather',
  aliases: ['clima'],
  description: 'Muestra el clima de una ubicación',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const args = context.args || [];
    
    // Get location from args or use default
    let location = args.join(' ').trim() || 'autoip'; // autoip detects location from IP
    
    if (!location) {
      await context.reply('⚠️ Proporciona una ubicación para consultar el clima.\n\nUsa: .weather <ubicación>\nEjemplo: .weather Nueva York\nEjemplo: .weather (usa tu IP para detección automática)');
      return;
    }

    try {
      // Send processing indicator
      try {
        if (typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('composing', context.chatId);
        }
      } catch (e) {
        // ignore presence errors
      }

      // Use wttr.in service (free, no API key required)
      const url = `https://wttr.in/${encodeURIComponent(location)}?format=3`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Error al consultar el servicio de clima: ${response.status}`);
      }
      
      const weatherInfo = await response.text();
      
      await context.reply(`🌤️ Clima:\n${weatherInfo.trim()}`);

      // Clear presence
      try {
        if (typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
      } catch (e) {
        // ignore
      }
    } catch (error) {
      // Clear presence on error
      try {
        if (typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
      } catch (e) {
        // ignore
      }

      context.handler.logger?.warning?.('Weather request failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible obtener el clima. Verifique la ubicación e intente de nuevo más tarde.');
    }
  }
};

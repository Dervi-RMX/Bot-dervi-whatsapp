const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');

module.exports = {
  name: 'shorturl',
  aliases: ['acortar'],
  description: 'Acorta URLs usando servicios gratuitos',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const args = context.args || [];
    
    // Get URL from args or detected content
    let urlToShorten = args.join(' ').trim();
    if (!urlToShorten && detection.type === 'url' && detection.url) {
      urlToShorten = detection.url;
    }
    
    if (!urlToShorten) {
      await context.reply('⚠️ Proporciona una URL para acortar.\n\nUsa: .shorturl <url>\nO envía una URL y usa: .shorturl');
      return;
    }

    // Validate the URL
    const safe = await validateSafeUrl(urlToShorten);
    if (!safe.valid) {
      await context.reply('⚠️ URL no segura o bloqueada.');
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

      // Use tinyurl.com API (free, no API key required for basic usage)
      const apiUrl = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(safe.url)}`;
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`Error al acortar URL: ${response.status}`);
      }
      
      const shortUrl = await response.text();
      
      // Validate that we got a reasonable response
      if (!shortUrl.startsWith('http')) {
        throw new Error('Respuesta inválida del servicio de acortamiento');
      }
      
      await context.reply(`🔗 URL acortada:\n${shortUrl}\n\nOriginal: ${safe.url}`);

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

      context.handler.logger?.warning?.('ShortURL request failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible acortar la URL. Intente de nuevo más tarde o verifique que la URL sea válida.');
    }
  }
};

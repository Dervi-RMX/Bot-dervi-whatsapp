const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl, formatDuration } = require('../lib/utils');

async function fetchSpotifyMeta(url) {
  const safe = await validateSafeUrl(url);
  if (!safe.valid) throw new Error(safe.reason);
  const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(safe.url)}`;
  const response = await fetch(endpoint, { headers: { 'user-agent': 'BOT-SANDBOX/1.0' } });
  if (!response.ok) throw new Error('No se pudo obtener metadata');
  return response.json();
}

module.exports = {
  name: 'spotify',
  aliases: [],
  description: 'Muestra metadata de Spotify',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /spotify\.com/i.test(u));

    if (!url) {
      await context.reply('⚠️ No fue posible procesar este contenido.');
      return;
    }

    try {
      const data = await fetchSpotifyMeta(url);
      await context.reply(
        [
          '🎵 SPOTIFY',
          '',
          `Canción: ${data.title || 'N/D'}`,
          `Artista: ${data.author_name || 'N/D'}`,
          `Álbum: ${data.provider_name || 'N/D'}`,
          `Duración: ${data.duration ? formatDuration(data.duration) : 'N/D'}`
        ].join('\n')
      );
    } catch {
      await context.reply('⚠️ No fue posible procesar este contenido.');
    }
  }
};


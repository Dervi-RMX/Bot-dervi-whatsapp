const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl, formatDuration } = require('../lib/utils');

async function fetchYouTubeMeta(url) {
  const safe = await validateSafeUrl(url);
  if (!safe.valid) throw new Error(safe.reason);
  const response = await fetch(safe.url, { headers: { 'user-agent': 'BOT-SANDBOX/1.0' } });
  if (!response.ok) throw new Error('No se pudo obtener el contenido');
  const html = await response.text();
  const title = html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]
    || html.match(/"title":"([^"]+)"/i)?.[1]
    || 'N/D';
  const channel = html.match(/<link itemprop="name" content="([^"]+)"/i)?.[1]
    || html.match(/"author":"([^"]+)"/i)?.[1]
    || 'N/D';
  const lengthSeconds = html.match(/"lengthSeconds":"?(\d+)"?/i)?.[1];
  const approxDurationMs = html.match(/"approxDurationMs":"?(\d+)"?/i)?.[1];
  const duration = lengthSeconds
    ? formatDuration(Number(lengthSeconds))
    : approxDurationMs
      ? formatDuration(Math.round(Number(approxDurationMs) / 1000))
      : 'N/D';
  return { title, channel, duration };
}

module.exports = {
  name: 'yt',
  aliases: ['youtube'],
  description: 'Muestra metadata de YouTube',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /youtu\.be|youtube\.com/i.test(u));

    if (!url) {
      await context.reply('⚠️ No fue posible procesar este contenido.');
      return;
    }

    try {
      const meta = await fetchYouTubeMeta(url);
      await context.reply(
        [
          '🎬 YOUTUBE',
          '',
          `Título: ${meta.title}`,
          `Canal: ${meta.channel}`,
          `Duración: ${meta.duration}`
        ].join('\n')
      );
    } catch {
      await context.reply('⚠️ No fue posible procesar este contenido.');
    }
  }
};

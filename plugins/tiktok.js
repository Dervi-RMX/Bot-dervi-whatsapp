const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'tiktok',
  aliases: [],
  description: 'Descarga videos públicos de TikTok cuando sea posible (respeta DRM/marcas)',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const urls = detection.type === 'url' && detection.url ? [detection.url] : extractUrls(detection.text || '');
    const url = urls.find(u => /tiktok\.com/i.test(u));
    if (!url) {
      // keep concise and rely on presence indicator from handler
      await context.reply('⚠️ No fue posible procesar este contenido.');
      return;
    }

    const safe = await validateSafeUrl(url);
    if (!safe.valid) {
      await context.reply('⚠️ URL no segura o bloqueada.');
      return;
    }

    // retry strategy: keep it fast — 2 attempts with short backoff and modest timeout
    const maxAttempts = 2;
    const baseTimeout = Math.max(120000, Number(context.handler.config.downloadTimeout || 120000)); // 2 min base
    let lastErr = null;

    // check for cookies file in temp (optional) to help with anti-bot challenges
    const cookiesPath = path.join(context.handler.config.tempDirectory || 'tmp', 'cookies.txt');
    const cookiesExist = fs.existsSync(cookiesPath);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const timeoutForAttempt = Math.min(baseTimeout * attempt, 5 * 60 * 1000); // cap 5min
        const opts = { timeout: timeoutForAttempt };
        if (cookiesExist) opts.cookies = cookiesPath;

        context.handler.logger?.info?.(`tiktok: attempt ${attempt} with timeout ${timeoutForAttempt}${cookiesExist ? ' (cookies)' : ''}`);

        const dl = await downloadWithYtDlp(safe.url, context.handler.config.tempDirectory, opts);
        if (!dl || !dl.filePath) throw new Error('No se descargó el archivo');

        await context.sendTempFile(dl.filePath, { fileName: path.basename(dl.filePath), mimeType: 'video/mp4', kind: 'video' });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        context.handler.logger?.warning?.(`tiktok attempt ${attempt} failed`, { error: err?.toString?.() || String(err) });
        // short backoff before retrying
        const backoff = attempt === 1 ? 500 : 1500; // 0.5s, 1.5s
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    if (lastErr) {
      context.handler.logger?.error?.('tiktok download failed after retries', { error: lastErr?.toString?.() || String(lastErr) });
      // suppress internal yt-dlp details from user; give concise guidance
      await context.reply('⚠️ No fue posible descargar el vídeo. Intenta de nuevo más tarde.');
    }
  }
};


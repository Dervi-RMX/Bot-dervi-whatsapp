const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const path = require('path');

function isUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  name: 'play',
  aliases: [],
  description: 'Descarga audio/video de URL o busca y descarga: .play <url_o_busqueda>',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const query = args.join(' ').trim();
    if (!query) {
      await context.reply(`⚠️ Por favor, proporciona una URL o una búsqueda.\n\nUsa: .play <url_o_busqueda>`);
      return;
    }

    let urlToDownload = null;
    const detected = context.currentDetection || detectMessageContent(context.message);
    // If the message contains a URL, we might prefer that over the args? But we are using args.
    // We'll stick to the args provided.

    // Check if the query is a URL
    if (isUrl(query)) {
      urlToDownload = query;
    } else {
      // Treat as search query for YouTube
      urlToDownload = `ytsearch:${query}`;
    }

    // Send processing indicator (no message, just presence)
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
      const dl = await downloadWithYtDlp(
        urlToDownload,
        context.handler.config.tempDirectory,
        {
          timeout: Math.max(120000, Number(context.handler.config.downloadTimeout || 120000)),
          // We want audio only if possible? But the user might want video.
          // We'll let yt-dlp choose the best format, but we can prefer audio/music.
          // For simplicity, we'll use the default behavior of yt-dlp (best quality).
          // If we want to force audio, we can add '-x --audio-format mp3' but that might not be what the user wants.
          // We'll leave it as is and let the user specify if they want audio only by using .ytmp3 or similar.
          // For .play, we'll download the best available format.
        }
      );

      if (!dl || !dl.filePath) {
        throw new Error('No se descargó el archivo');
      }

      // Determine if it's audio or video based on mime type or extension
      const mimeType = dl.mimeType || '';
      const isAudio = mimeType.startsWith('audio/');
      const isVideo = mimeType.startsWith('video/');

      await context.sendTempFile(dl.filePath, {
        fileName: path.basename(dl.filePath),
        mimeType: dl.mimeType || 'application/octet-stream',
        kind: isAudio ? 'audio' : (isVideo ? 'video' : 'document'),
        caption: isAudio ? '🎵 Audio descargado' : (isVideo ? '🎬 Video descargado' : '📄 Archivo descargado')
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

      context.handler.logger?.warning?.('Play download failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible descargar el contenido. Puede que la URL no sea válida, el contenido no esté disponible o haya ocurrido un error.');
    }
  }
};
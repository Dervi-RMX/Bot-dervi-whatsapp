const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const fs = require('fs');
const path = require('path');

function resolveFfmpeg() {
  const localPath = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(localPath)) return localPath;
  try {
    return require('ffmpeg-static');
  } catch {
    return null;
  }
}

function isUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function scheduleAudioDeletion(context, sentMessage) {
  const messageKey = sentMessage?.key;
  if (!messageKey?.id || !context.client?.sendMessage) return;

  const deletionDelay = 20 * 60 * 1000;
  setTimeout(async () => {
    try {
      await context.client.sendMessage(context.chatId, { delete: messageKey });
      context.handler.logger?.info?.('Audio de .play eliminado automáticamente', {
        chatId: context.chatId,
        messageId: messageKey.id
      });
    } catch (error) {
      context.handler.logger?.warning?.('No se pudo eliminar automáticamente el audio de .play', {
        chatId: context.chatId,
        messageId: messageKey.id,
        error: error?.message || String(error)
      });
    }
  }, deletionDelay);
}

module.exports = {
  name: 'play',
  aliases: [],
  description: 'Descarga audio/video de URL o busca y descarga: .play <url_o_busqueda>',
  groupOnly: false,
  adminOnly: false,
  timeoutMs: 900000,
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
      urlToDownload = `ytsearch1:${query}`;
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

    let downloadedFilePath = null;
    try {
      const dl = await downloadWithYtDlp(
        urlToDownload,
        context.handler.config.tempDirectory,
        {
          timeout: Math.max(120000, Number(context.handler.config.downloadTimeout || 120000)),
          audioOnly: true,
          // MP3 is the most compatible audio format for WhatsApp clients.
          convertAudio: true,
          audioFormat: 'mp3',
          audioQuality: '5',
          format: 'bestaudio/best',
          concurrentFragments: 4,
          jsRuntimes: [],
          ffmpegLocation: resolveFfmpeg()
        }
      );

      if (!dl || !dl.filePath) {
        throw new Error('No se descargó el archivo');
      }
      downloadedFilePath = dl.filePath;

      const mimeType = 'audio/mpeg';

      const sentMessage = await context.sendTempFile(dl.filePath, {
        fileName: path.basename(dl.filePath, path.extname(dl.filePath)) + '.mp3',
        mimeType,
        kind: 'audio',
        caption: '🎵 Audio descargado'
      });
      scheduleAudioDeletion(context, sentMessage);

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

      const reason = String(error?.message || error || 'Error desconocido')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      context.handler.logger?.warning?.('Play download failed', { error: reason });
      await context.reply(`⚠️ No fue posible descargar el contenido.\n\nMotivo: ${reason}`);
    } finally {
      if (downloadedFilePath) {
        await fs.promises.unlink(downloadedFilePath).catch(() => null);
      }
    }
  }
};
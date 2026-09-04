const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadWithYtDlp } = require('../lib/downloader');
const fs = require('fs');
const path = require('path');
const infoImagePath = path.join(__dirname, '..', 'assets', 'play-info.jpg');

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

function scheduleMessageDeletion(context, sentMessage, delayMs, label) {
  const messageKey = sentMessage?.key;
  if (!messageKey?.id || !context.client?.sendMessage) return;

  setTimeout(async () => {
    try {
      await context.client.sendMessage(context.chatId, { delete: messageKey });
      context.handler.logger?.info?.(`${label} de .play eliminado automáticamente`, {
        chatId: context.chatId,
        messageId: messageKey.id
      });
    } catch (error) {
      context.handler.logger?.warning?.(`No se pudo eliminar automáticamente ${label.toLowerCase()} de .play`, {
        chatId: context.chatId,
        messageId: messageKey.id,
        error: error?.message || String(error)
      });
    }
  }, delayMs);
}

function scheduleAudioDeletion(context, sentMessage) {
  scheduleMessageDeletion(context, sentMessage, 20 * 60 * 1000, 'Audio');
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return 'No disponible';
  const minutes = Math.floor(total / 60);
  const remaining = Math.floor(total % 60);
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function formatSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return 'No disponible';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 2 : 0)} ${units[unit]}`;
}

async function sendTrackInfo(context, metadata, filePath, sourceUrl) {
  const channel = metadata?.channel || metadata?.uploader || metadata?.creator || 'No disponible';
  const duration = formatDuration(metadata?.duration);
  const quality = metadata?.abr
    ? `${Math.round(Number(metadata.abr))} kbps`
    : (metadata?.format_note || metadata?.acodec || 'MP3');
  const size = formatSize(metadata?.filesize || metadata?.filesize_approx || fs.statSync(filePath).size);
  const url = metadata?.webpage_url || (isUrl(sourceUrl) ? sourceUrl : 'No disponible');
  const title = metadata?.track || metadata?.title || 'Audio solicitado';
  const text = [
    `🎵 *${title}*`,
    '',
    `◈ Canal » *${channel}*`,
    `◈ Duración » *${duration}*`,
    `◈ Calidad » *${quality}*`,
    `◈ Tamaño » *${size}*`,
    `◈ URL » ${url}`
  ].join('\n');

  if (fs.existsSync(infoImagePath)) {
    const sentMessage = await context.client.sendMessage(context.chatId, {
      image: fs.readFileSync(infoImagePath),
      caption: text
    }, { quoted: context.quoted || context.message });
    scheduleMessageDeletion(context, sentMessage, 15 * 60 * 1000, 'Ficha informativa');
  } else {
    const sentMessage = await context.reply(text);
    scheduleMessageDeletion(context, sentMessage, 15 * 60 * 1000, 'Ficha informativa');
  }
}

async function sendInitialTrackInfo(context, query, sourceUrl) {
  const text = [
    `🎵 *${query}*`,
    '',
    '◈ Canal » *Buscando información...*',
    '◈ Duración » *Calculando...*',
    '◈ Calidad » *Calculando...*',
    '◈ Tamaño » *Calculando...*',
    `◈ URL » ${isUrl(sourceUrl) ? sourceUrl : 'Búsqueda de YouTube'}`,
    '',
    '⏳ Preparando tu audio...'
  ].join('\n');

  if (fs.existsSync(infoImagePath)) {
    return context.client.sendMessage(context.chatId, {
      image: fs.readFileSync(infoImagePath),
      caption: text
    }, { quoted: context.quoted || context.message });
  }
  return context.reply(text);
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

    let initialInfoMessage = null;
    let downloadedFilePath = null;
    try {
      // Respond immediately while yt-dlp resolves metadata and downloads the audio.
      initialInfoMessage = await sendInitialTrackInfo(context, query, urlToDownload);
      const dl = await downloadWithYtDlp(
        urlToDownload,
        context.handler.config.tempDirectory,
        {
          timeout: Math.max(90000, Number(context.handler.config.downloadTimeout || 90000)),
          audioOnly: true,
          // MP3 is the most compatible audio format for WhatsApp clients.
          convertAudio: true,
          audioFormat: 'mp3',
          audioQuality: '7',
          format: 'bestaudio/best',
          concurrentFragments: 4,
          printMetadata: true,
          retries: 1,
          fragmentRetries: 1,
          socketTimeout: 20,
          maxAttempts: 2,
          jsRuntimes: [],
          ffmpegLocation: resolveFfmpeg()
        }
      );

      if (!dl || !dl.filePath) {
        throw new Error('No se descargó el archivo');
      }
      downloadedFilePath = dl.filePath;

      const mimeType = 'audio/mpeg';
      await sendTrackInfo(context, dl.metadata, dl.filePath, urlToDownload);
      if (initialInfoMessage?.key?.id) {
        await context.client.sendMessage(context.chatId, { delete: initialInfoMessage.key }).catch(() => null);
      }

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
      if (initialInfoMessage?.key?.id) {
        await context.client.sendMessage(context.chatId, { delete: initialInfoMessage.key }).catch(() => null);
      }
      await context.reply(`⚠️ No fue posible descargar el contenido.\n\nMotivo: ${reason}`);
    } finally {
      if (downloadedFilePath) {
        await fs.promises.unlink(downloadedFilePath).catch(() => null);
      }
    }
  }
};
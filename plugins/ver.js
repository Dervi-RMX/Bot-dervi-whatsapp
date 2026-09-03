const { detectMessageContent } = require('../lib/content-detector');
const { extractUrls, validateSafeUrl } = require('../lib/utils');
const { downloadQuotedMedia, downloadUrlToTempFile } = require('../lib/downloader');
const { buildOutboundPayload, inferOutboundKindFromMime } = require('../lib/media');
const path = require('path');

module.exports = {
  name: 'ver',
  aliases: ['view'],
  description: 'Procesa y reenvía el contenido citado o actual al chat privado del propietario sin mostrar mensajes ni notificaciones',
  async execute(context) {
    let presenceSent = false;
    try {
      // Send processing indicator
      try {
        if (typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('composing', context.chatId);
          presenceSent = true;
        }
      } catch (e) {
        // ignore presence errors
      }

      const detection = context.currentDetection || detectMessageContent(context.message);
      let filePath = null;
      let meta = {};

      // Process content to get file to send
      if (detection.type === 'url' && detection.url) {
        // Validate URL safety
        const safe = await validateSafeUrl(detection.url);
        if (!safe.valid) {
          // Log internally but don't show message in chat
          context.handler.logger?.warning?.('Invalid URL in .ver command', { url: detection.url });
          return;
        }

        const download = await downloadUrlToTempFile(safe.url, context.handler.config.tempDirectory, {
          maxBytes: context.handler.config.maxFileSize,
          timeout: context.handler.config.downloadTimeout
        });

        filePath = download.filePath;
        meta = {
          fileName: path.basename(new URL(safe.url).pathname) || 'archivo',
          mimeType: download.mimeType || '',
          kind: download.kind || 'document'
        };
      } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(detection.type)) {
        const source = detection.source === 'quoted-message'
          ? detection.message
          : (getQuotedMessage(context.message) || context.message);
        filePath = await downloadQuotedMedia(source, context.handler.config.tempDirectory);
        meta = {
          fileName: detection.fileName || context.mediaInfo?.fileName || 'archivo',
          mimeType: detection.mimeType || context.mediaInfo?.mimetype || '',
          kind: detection.type
        };
      } else {
        // No content to process - silently fail
        context.handler.logger?.warning?.('No processable content in .ver command');
        return;
      }

      // Get owner JID
      const ownerJid = context.handler.config.isSubbot
        ? (context.client.user?.id || context.client.user?.lid)
        : context.handler.config.ownerJid;
      if (!ownerJid) {
        // Log internally but don't show message in chat
        context.handler.logger?.warning?.('Owner JID not configured for .ver command');
        return;
      }

      // Send ONLY the file to owner's private chat (no text message)
      await context.handler.sendTempFile(ownerJid, filePath, meta, null);

    } catch (error) {
      // Log error internally but don't show message in chat
      context.handler.logger?.warning?.('Error in ver plugin', { error: error?.message || String(error) });
    } finally {
      // Clear presence indicator
      try {
        if (presenceSent && typeof context.client.sendPresenceUpdate === 'function') {
          await context.client.sendPresenceUpdate('paused', context.chatId).catch(() => null);
          await context.client.sendPresenceUpdate('available', context.chatId).catch(() => null);
        }
      } catch (e) {
        // ignore presence errors
      }
    }
  }
};
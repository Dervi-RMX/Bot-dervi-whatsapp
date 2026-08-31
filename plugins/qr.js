const QRCode = require('qrcode');
const { detectMessageContent } = require('../lib/content-detector');
const path = require('path');
const fs = require('fs');

module.exports = {
  name: 'qr',
  aliases: ['qrcode'],
  description: 'Genera códigos QR desde texto o URL',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const input = detection.type === 'url' && detection.url ? detection.url : (detection.text || '');

    if (!input.trim()) {
      await context.reply('⚠️ Proporciona texto o URL para generar el código QR.\n\nUsa: .qr <texto_o_url>');
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

      // Generate QR code as PNG buffer
      const qrBuffer = await QRCode.toBuffer(input.trim(), {
        errorCorrectionLevel: 'M',
        type: 'png',
        width: 300,
        margin: 1
      });

      // Save to temp file
      const tempFilePath = path.join(context.handler.config.tempDirectory || 'tmp', `qr_${Date.now()}.png`);
      await fs.promises.writeFile(tempFilePath, qrBuffer);

      await context.sendTempFile(tempFilePath, {
        fileName: 'codigo_qr.png',
        mimeType: 'image/png',
        kind: 'image',
        caption: `📱 Código QR generado para:\n${input.trim().length > 50 ? input.trim().substring(0, 50) + '...' : input.trim()}`
      });

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

      context.handler.logger?.warning?.('QR code generation failed', { error: error?.message || String(error) });
      await context.reply('⚠️ No fue posible generar el código QR. El texto podría ser demasiado largo o tener caracteres no soportados.');
    }
  }
};

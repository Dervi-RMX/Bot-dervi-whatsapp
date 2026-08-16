module.exports = {
  name: 'estado',
  aliases: ['status', 'estados', 'reaccionar'],
  description: 'Descarga y reenvía contenido de estados de WhatsApp a chat privado',
  async execute(context) {
    const message = context.message;
    const chatId = context.chatId || (message?.key?.remoteJid || '');
    const prefix = context.prefix || '.';

    // Obtener detección de contenido
    let detection = context.currentDetection;
    if (!detection) {
      const { detectMessageContent } = require('../lib/content-detector');
      detection = detectMessageContent(message);
    }

    // Si no hay mensaje o detección, mostrar ayuda
    if (!message || !detection) {
      await context.reply(`⚠️ Usa: ${prefix}estado\n\n${context.message?.message
        ? 'Reacciona a un estado con el comando'
        : 'Envía .estado para ver opciones'}`);
      return;
    }

    // === IDENTIFICAR SI ES ESTADO DE WHATSAPP ===
    // Estados de WhatsApp tienen características únicas:
    // 1. key.remoteJid === 'status@broadcast'
    // 2. message.statusMessage presente
    // 3. message.protocolMessage con author/creator
    const esEstadoWhatsApp =
      chatId === 'status@broadcast' ||
      (message?.message?.statusMessage) ||
      (message?.message?.protocolMessage &&
       (message.message.protocolMessage.author ||
        message.message.protocolMessage.creator));

    // === MODALIDAD 1: URL DIRECTA EN EL MENSAJE ===
    if (detection.type === 'url' && detection.url) {
      try {
        const download = await context.handler.lib.downloader.downloadUrlToTempFile(
          detection.url,
          context.handler.config.tempDirectory,
          {
            maxBytes: context.handler.config.maxFileSize,
            timeout: context.handler.config.downloadTimeout
          }
        );

        // Determinar remitente original del estado
        let senderJid = message.key?.fromMe
          ? context.handler.config.ownerJid
          : (message.key?.participant || message.key?.sender || chatId);

        // Si es estado de WhatsApp, obtener autor del protocolo
        if (esEstadoWhatsApp) {
          const protoMsg = message.message.protocolMessage || {};
          const authorJid = protoMsg.author || protoMsg.creator || '';
          if (authorJid) {
            senderJid = authorJid.includes('@')
              ? authorJid
              : (authorJid.startsWith('+') ? authorJid : `${authorJid}@s.whatsapp.net`);
          }
        }

        const meta = {
          fileName: path.basename(new URL(detection.url).pathname) || 'archivo',
          mimeType: download.mimeType || '',
          kind: download.kind || 'file'
        };

        await context.sendTempFile(download.filePath, {
          ...meta,
          caption: `📥 Descargado de tu estado\n👤 De: ${senderJid}`
        });
        await context.reply(`✅ Estado descargado y enviado en privado`);
        return;
      } catch (error) {
        console.error('Error descargando URL:', error.message);
        // Continuar a siguiente modalidad en lugar de fallar
      }
    }

    // === MODALIDAD 2: CONTENIDO CITADO (respondiendo a un mensaje) ===
    if (detection.type && detection.type !== 'text') {
      try {
        const source = context.getQuotedMessage?.(message) || message;
        const filePath = await context.handler.lib.downloader.downloadQuotedMedia(source, context.handler.config.tempDirectory);

        const media = context.handler.lib.media.getMediaInfo({ message: source });
        const meta = {
          fileName: media?.fileName || 'archivo',
          mimeType: media?.mimetype || '',
          kind: media?.type || detection.type || 'file'
        };

        let senderJid = message.key?.fromMe
          ? context.handler.config.ownerJid
          : (message.key?.participant || message.key?.sender || chatId);

        // Si hay author en protocolo, usarlo
        if (message.message?.protocolMessage?.author) {
          senderJid = message.message.protocolMessage.author;
        }

        // Determinar tipo de mídia para caption
        const tipoCaption = meta.kind === 'video' ? 'video' : 'foto';
        await context.sendTempFile(filePath, {
          ...meta,
          caption: `📥 ${tipoCaption} de estado citado\n👤 De: ${senderJid}`
        });
        await context.reply(`✅ ${tipoCaption} estado citado descargado y enviado en privado`);
        return;
      } catch (error) {
        console.error('Error contenido citado:', error.message);
        // Continuar en lugar de abortar
      }
    }

    // === MODALIDAD 3: ESTADO DIRECTO SIN URL (foto o video puros) ===
    // Si es específicamente un estado de WhatsApp (no URL, sino media directo)
    if (esEstadoWhatsApp && !detection.url) {
      try {
        // Crear wrapped object para downloadQuotedMedia
        const wrapped = { message: message.message };
        const filePath = await context.handler.lib.downloader.downloadQuotedMedia(wrapped, context.handler.config.tempDirectory);

        const media = context.handler.lib.media.getMediaInfo(message.message || {});
        const meta = {
          fileName: media?.fileName || 'archivo-estado',
          mimeType: media?.mimetype || '',
          kind: media?.type ||
            (message.message?.videoMessage ? 'video' :
             message.message?.imageMessage ? 'image' : 'file')
        };

        // Obtener autor original con manejo de errores
        let autorOriginal = message.key?.participant || message.key?.sender || chatId;
        try {
          const protoMsg = message.message.protocolMessage || {};
          if (protoMsg.author) {
            autorOriginal = protoMsg.author;
          } else if (protoMsg.creator) {
            autorOriginal = protoMsg.creator;
          }
        } catch (e) {
          // Usar valor por defecto
        }

        // Determinar tipo de mídia para caption
        const tipoMedia = meta.kind === 'video' ? 'video' : 'foto';
        await context.sendTempFile(filePath, {
          ...meta,
          caption: `📥 ${tipoMedia} descargado del estado\n👤 Original: ${autorOriginal}`
        });
        await context.reply(`✅ ${tipoMedia} estado descargado y enviado en chat privado`);
        return;
      } catch (error) {
        console.error('Error estado directo:', error.message);
        // Continuar al fallback informativo
      }
    }

    // === FALLBACK: Mostrar información útil al usuario ===
    // Dar pistas sobre por qué no se descargó
    let fallbackText = '⚠️ No fue posible descargar el contenido de este estado.\n\n';

    if (context.message?.message) {
      fallbackText += '🔍 **Causas probables:**\n'
        + '• El estado tiene restricciones de privacidad (solo para el creador)\n'
        + '• El video/foto expiró después de 24h\n'
        + '• El contenido fue eliminado por el emisor\n'
        + '• WhatsApp bloquea descarga de ciertos formatos\n\n'
        + '💡 **Soluciones:**\n'
        + '• Intenta con un estado público\n'
        + '• Reacciona a estados más recientes\n'
        + '• Algunos videos requieren estar en la lista de contactos';
    } else {
      fallbackText += '• Usa .estado respondiendo a un estado con imagen o video';
    }

    await context.reply(fallbackText);
  }
};
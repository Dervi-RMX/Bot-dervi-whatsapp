const { normalizeJid } = require('../lib/moderation');
const logger = require('../lib/logger');

function extractTargetJid(context) {
  const getMessageEntry = (context) => {
    const content = context.getMessageContent ? context.getMessageContent() : {};
    const type = Object.keys(content || {})[0];
    return type ? content[type] : null;
  };

  const entry = getMessageEntry(context) || {};
  const mentioned = entry?.contextInfo?.mentionedJid || [];
  if (Array.isArray(mentioned) && mentioned.length) {
    const jid = normalizeJid(mentioned[0]);
    return jid || null;
  }

  const quotedParticipant = entry?.contextInfo?.participant;
  if (quotedParticipant) {
    const jid = normalizeJid(quotedParticipant);
    return jid || null;
  }

  const rawArg = String(context.args?.[0] || '').trim();
  if (!rawArg) return null;
  if (rawArg.includes('@')) {
    const jid = normalizeJid(rawArg);
    return jid || null;
  }
  const digits = rawArg.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

module.exports = {
  name: 'owner',
  aliases: [],
  description: 'Comandos del propietario: owner, broadcast, addowner, delowner, restart, stats',
  ownerOnly: true,
  async execute(context) {
    const args = context.args || [];
    const subcmd = String(args[0] || '').toLowerCase();

    // If no subcommand, treat as owner info
    if (!subcmd) {
      return await this._owner(context, args);
    }

    switch (subcmd) {
      case 'broadcast':
        return await this._broadcast(context, args.slice(1));
      case 'addowner':
        return await this._addowner(context, args.slice(1));
      case 'delowner':
        return await this._delowner(context, args.slice(1));
      case 'restart':
        return await this._restart(context, args.slice(1));
      case 'stats':
        return await this._stats(context, args.slice(1));
      default:
        // If subcmd looks like a target, maybe they meant addowner? We'll fallback to addowner.
        if (subcmd.includes('@') || /^\d+$/.test(subcmd)) {
          return await this._addowner(context, args);
        }
        await context.reply(`⚠️ Subcomando desconocido: ${subcmd}\nUso:\n${context.prefix}owner\n${context.prefix}broadcast <mensaje>\n${context.prefix}addowner @usuario\n${context.prefix}delowner @usuario\n${context.prefix}restart\n${context.prefix}stats`);
    }
  },

  async _owner(context, args) {
    const ownerJid = context.handler.config.ownerJid || 'No configurado';
    const persistentOwners = context.handler.persistentOwners || [];
    let replyText = `👤 *Propietario principal del bot:*\n${ownerJid}\n\n`;

    if (persistentOwners.length > 0) {
      replyText += `👥 *Propietarios adicionales persistentes:*\n`;
      persistentOwners.forEach((owner, index) => {
        replyText += `${index + 1}. @${owner.split('@')[0]}\n`;
      });
    } else {
      replyText += `👥 *No hay propietarios adicionales persistentes configurados.*\n`;
    }

    await context.reply(replyText);
  },

  async _broadcast(context, args) {
    const message = args.join(' ').trim();
    if (!message) {
      await context.reply(`⚠️ Especifique el mensaje a transmitir: ${context.prefix}broadcast <mensaje>`);
      return;
    }

    // Get all chats and filter for groups
    let chatIds = [];
    try {
      // Method 1: Try to get chats as a Map (common in Baileys)
      if (context.handler.client.chats && typeof context.handler.client.chats === 'object') {
        if (context.handler.client.chats instanceof Map) {
          // It's a Map, get all keys (JIDs)
          chatIds = Array.from(context.handler.client.chats.keys());
        } else {
          // It's an Object, get all keys
          chatIds = Object.keys(context.handler.client.chats);
        }
      }

      // Method 2: Try getAllChats method if available
      if (chatIds.length === 0 && typeof context.handler.client.getAllChats === 'function') {
        const result = await context.handler.client.getAllChats();
        if (Array.isArray(result)) {
          chatIds = result;
        } else if (result && typeof result === 'object') {
          if (result instanceof Map) {
            chatIds = Array.from(result.keys());
          } else {
            chatIds = Object.keys(result);
          }
        }
      }

      // Method 3: Try to get chats property directly as array
      if (chatIds.length === 0 && Array.isArray(context.handler.client.chats)) {
        chatIds = context.handler.client.chats;
      }
    } catch (error) {
      logger.warning('Error getting chats from socket', { error: error.message });
    }

    // If still no chats, try to get from groupInfoCache (what we've seen so far)
    if (chatIds.length === 0) {
      chatIds = Array.from(context.handler.groupInfoCache.keys());
    }

    // Filter for groups only (JIDs ending with @g.us) and extract JID fromObjects if needed
    const groupChats = chatIds
      .map(chatId => {
        // Handle different possible chat ID formats
        if (typeof chatId === 'string') return chatId;
        if (chatId && typeof chatId === 'object') {
          if (chatId.id) return chatId.id;
          if (chatId.jid) return chatId.jid;
          if (chatId.chatId) return chatId.chatId;
        }
        return null;
      })
      .filter(id => id && typeof id === 'string' && id.endsWith('@g.us'));

    if (groupChats.length === 0) {
      await context.reply(`⚠️ No se encontraron grupos para transmitir. Asegúrate de que el bot esté unido a algunos grupos primero.`);
      return;
    }

    await context.reply(`📢 *Iniciando transmisión a ${groupChats.length} grupos...*`);

    let sentCount = 0;
    let failedCount = 0;
    const failedGroups = [];

    for (const [index, groupId] of groupChats.entries()) {
      try {
        await context.sendText(groupId, message);
        sentCount++;
        // Add delay between messages to avoid rate limiting (except for the last one)
        if (index < groupChats.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }
      } catch (error) {
        failedCount++;
        failedGroups.push({ id: groupId, error: error.message });
        logger.warning(`Failed to send broadcast to group ${groupId}`, { error: error.message });
        // Continue with next group even if this one fails
      }
    }

    // Send summary
    let summary = `📢 *BROADCAST FINALIZADO*\n\n`;
    summary += `✅ Enviados: ${sentCount}\n`;
    summary += `❌ Fallidos: ${failedCount}\n`;
    summary += `📊 Total: ${groupChats.length}\n\n`;

    if (failedCount > 0) {
      summary += `*Grupos fallidos:*\n`;
      failedGroups.slice(0, 5).forEach(({ id }, index) => {
        summary += `${index + 1}. @${id.split('@')[0]}\n`;
      });
      if (failedCount > 5) {
        summary += `... y ${failedCount - 5} más\n`;
      }
    }

    await context.reply(summary);
  },

  async _addowner(context, args) {
    // Create a context with args for extractTargetJid
    const targetContext = { ...context, args };
    const target = extractTargetJid(targetContext);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}addowner @usuario`);
      return;
    }
    // Check if trying to add the main owner
    const mainOwner = normalizeJid(context.handler.config.ownerJid || '');
    if (mainOwner && target === mainOwner) {
      await context.reply(`⚠️ El usuario @${target.split('@')[0]} ya es el propietario principal.`);
      return;
    }

    // Add to persistent owners
    const added = context.handler.addPersistentOwner(target);
    if (added) {
      await context.reply(`✅ Usuario @${target.split('@')[0]} agregado como propietario persistente.`);
    } else {
      await context.reply(`⚠️ El usuario @${target.split('@')[0]} ya está en la lista de propietarios persistentes.`);
    }
  },

  async _delowner(context, args) {
    // Create a context with args for extractTargetJid
    const targetContext = { ...context, args };
    const target = extractTargetJid(targetContext);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}delowner @usuario`);
      return;
    }

    // Check if trying to remove the main owner
    const mainOwner = normalizeJid(context.handler.config.ownerJid || '');
    if (mainOwner && target === mainOwner) {
      await context.reply(`⛔ No se puede eliminar al proprietario principal configurado en las variables de entorno.`);
      return;
    }

    // Remove from persistent owners
    const removed = context.handler.removePersistentOwner(target);
    if (removed) {
      await context.reply(`✅ Usuario @${target.split('@')[0]} eliminado de propietarios persistentes.`);
    } else {
      await context.reply(`⚠️ El usuario @${target.split('@')[0]} no se encontró en la lista de propietarios persistentes.`);
    }
  },

  async _restart(context, args) {
    await context.reply(`🔄 Reiniciando el bot...`);
    try {
      // Close the current socket to trigger reconnection logic
      if (typeof context.handler.client.end === 'function') {
        await context.handler.client.end();
      } else if (typeof context.handler.client.close === 'function') {
        await context.handler.client.close();
      } else {
        // Fallback: destroy the socket if available
        if (typeof context.handler.client.destroy === 'function') {
          await context.handler.client.destroy();
        }
      }
    } catch (error) {
      logger.warning('Error reiniciando bot mediante cierre de socket', { error: error.message });
      // Even if closing fails, we still consider the restart initiated
    }
    // Note: The actual restart is handled by the reconnection logic in main.js
    // which will attempt to reconnect after the socket is closed.
  },

  async _stats(context, args) {
    const uptimeSeconds = process.uptime();
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    // Get bot name
    const botName = "Dervi"; // Could be made configurable

    // Get connection status
    const isConnected = !!context.handler.client?.user?.id;
    const status = isConnected ? "🟢 En línea" : "🔴 Desconectado";

    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const memoryMB = (memoryUsage.rss / 1024 / 1024).toFixed(2);

    // Get plugins count
    const pluginsCount = context.handler.plugins.size;

    // Get groups count (using similar logic to broadcast)
    let groupCount = 0;
    try {
      // Method 1: Try to get chats as a Map (common in Baileys)
      if (context.handler.client.chats && typeof context.handler.client.chats === 'object') {
        if (context.handler.client.chats instanceof Map) {
          // It's a Map, count group JIDs
          groupCount = Array.from(context.handler.client.chats.keys())
            .filter(id => id && typeof id === 'string' && id.endsWith('@g.us')).length;
        } else {
          // It's an Object, count group keys
          groupCount = Object.keys(context.handler.client.chats)
            .filter(id => id && typeof id === 'string' && id.endsWith('@g.us')).length;
        }
      }

      // Method 2: Try getAllChats method if available
      if (groupCount === 0 && typeof context.handler.client.getAllChats === 'function') {
        const result = await context.handler.client.getAllChats();
        if (Array.isArray(result)) {
          groupCount = result
            .filter(id => id && typeof id === 'string' && id.endsWith('@g.us')).length;
        } else if (result && typeof result === 'object') {
          if (result instanceof Map) {
            groupCount = Array.from(result.keys())
              .filter(id => id && typeof id === 'string' && id.endsWith('@g.us')).length;
          } else {
            groupCount = Object.keys(result)
              .filter(id => id && typeof id === 'string' && id.endsWith('@g.us')).length;
          }
        }
      }

      // Method 3: Try to get chats property directly as array
      if (groupCount === 0 && Array.isArray(context.handler.client.chats)) {
        groupCount = context.handler.client.chats
          .filter(id => id && typeof id === 'string' && id.endsWith('@g.us')).length;
      }
    } catch (error) {
      logger.warning('Error getting groups count for stats', { error: error.message });
    }

    // If still no groups count, try to get from groupInfoCache (what we've seen so far)
    if (groupCount === 0) {
      groupCount = Array.from(context.handler.groupInfoCache.keys())
        .filter(id => id && typeof id === 'string' && id.endsWith('@g.us')).length;
    }

    // Get owners count
    const mainOwner = context.handler.config.ownerJid ? 1 : 0;
    const persistentOwnersCount = context.handler.persistentOwners.length;
    const ownersCount = mainOwner + persistentOwnersCount;

    // Get Node.js version
    const nodeVersion = process.version;

    // Format the stats in a nice box
    let statsText = `╭━━〔 📊 ${botName} STATS 〕━━╮\n`;
    statsText += `┃\n`;
    statsText += `┃ 🤖 Bot: ${botName}\n`;
    statsText += `┃ ${status}\n`;
    statsText += `┃ ⏱️ Uptime: ${uptimeStr}\n`;
    statsText += `┃ 💾 RAM: ${memoryMB} MB\n`;
    statsText += `┃ 🧩 Plugins: ${pluginsCount}\n`;
    statsText += `┃ 👥 Grupos: ${groupCount}\n`;
    statsText += `┃ 👤 Owners: ${ownersCount} (${mainOwner} principal + ${persistentOwnersCount} persistente${persistentOwnersCount !== 1 ? 's' : ''})\n`;
    statsText += `┃ ⚡ Node.js: ${nodeVersion}\n`;
    statsText += `┃\n`;
    statsText += `╰━━━━━━━━━━━━━━━━━━━━━━╯`;

    await context.reply(statsText);
  }
};
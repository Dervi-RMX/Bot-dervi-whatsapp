const fs = require('fs');
const path = require('path');
const { normalizeJid } = require('../lib/moderation');
const { createDataStore } = require('../lib/data-store');

const dataStore = createDataStore();
const fallbackImagePath = path.join(__dirname, '..', 'assets', 'fallback.webp');

function loadXPData() {
  try {
    return dataStore.read('xp.json', {});
  } catch (error) {
    console.error('Error loading XP data:', error);
    return {};
  }
}

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

function formatTimestamp(timestamp) {
  if (!timestamp) return 'No disponible';
  const date = new Date(timestamp);
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

module.exports = {
  name: 'perfil',
  aliases: [],
  description: 'Muestra información del perfil del usuario en formato de caja',
  category: 'utilities',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    try {
      // Determine target JID with priority: mentioned > quoted > sender
      let targetJid = extractTargetJid(context) || context.sender;
      if (!targetJid) {
        await context.reply('⚠️ No se pudo determinar el usuario.');
        return;
      }

      const client = context.handler.client;
      const normalizedTargetJid = normalizeJid(targetJid);
      let pushname = '';
      let phoneNumber = '';

      // 1. Try to get info from the quoted message (if replying to a message)
      if (context.quoted) {
        const msg = context.quoted.message;
        if (msg) {
          pushname = msg.pushName ?? msg.verifiedBizName ?? '';
        }
      }

      // 2. If still empty, try to get from cached contacts (using normalized JID)
      if (!pushname) {
        const contact = client.contacts?.[normalizedTargetJid];
        if (contact) {
          pushname = contact.pushname ?? contact.formattedName ?? contact.name ?? '';
          phoneNumber = contact.phoneNumber ?? '';
        }
      }

      // 3. If still empty, build a readable identifier from the JID (but never use number as name)
      if (!pushname) {
        const idPart = targetJid.split('@')[0];
        let clean = idPart;
        if (clean.startsWith('lid:')) {
          clean = clean.substring(4);
        }
        // Use a generic fallback, never the number
        pushname = 'Usuario desconocido';
      }

      // Get phone number from contact if not already obtained (using normalized JID)
      if (!phoneNumber) {
        const contact = client.contacts?.[normalizedTargetJid];
        if (contact) {
          phoneNumber = contact.phoneNumber ?? '';
        }
      }

      // If we still don't have a phone number, extract from JID (last resort)
      if (!phoneNumber) {
        let numberPart = normalizedTargetJid;
        if (numberPart.includes('@')) {
          numberPart = numberPart.split('@')[0];
        }
        if (numberPart.startsWith('lid:')) {
          numberPart = numberPart.substring(4);
        }
        // If it's all digits, format with plus
        if (/^\d+$/.test(numberPart)) {
          phoneNumber = `+${numberPart}`;
        } else {
          phoneNumber = numberPart; // fallback (shouldn't happen for regular users)
        }
      }

      // Load XP data for stats
      const xpData = loadXPData();
      const userData = xpData[normalizedTargetJid] || { xp: 0, level: 0, lastDaily: 0, lastActivityXP: 0 };

      // Approximate message count: each message gives 5 XP (with cooldown)
      const messageCount = Math.floor(userData.xp / 5);
      // Command count not tracked; show as not available
      const commandCount = 'No disponible';
      // Last activity timestamp from lastActivityXP
      const lastActivity = formatTimestamp(userData.lastActivityXP);

      // ID: just the numeric part without plus or lid
      const idPart = normalizedTargetJid.split('@')[0];
      let cleanId = idPart;
      if (cleanId.startsWith('lid:')) {
        cleanId = cleanId.substring(4);
      }
      const identificador = /^\d+$/.test(cleanId) ? cleanId : idPart; // fallback to original if not digits

      // Nombre and Alias both use pushname (or fallback)
      const nombre = pushname || 'Usuario desconocido';
      const alias = pushname || 'Usuario desconocido';

      // Get profile picture buffer (using normalized JID)
      let picBuffer = null;
      try {
        picBuffer = await client.getProfilePicture(normalizedTargetJid);
      } catch (err) {
        // Ignore errors, will use fallback
        context.handler.logger?.warning?.('Error getting profile picture', { error: err.message });
      }

      // Build the boxed message
      const lines = [];
      lines.push('╭━━━━〔 👤 PERFIL 〕━━━━╮');
      lines.push('┃');
      lines.push(`┃ 👤 Nombre: ${nombre}`);
      lines.push(`┃ 📱 Número: ${phoneNumber}`);
      lines.push(`┃ 🆔 ID: ${identificador}`);
      lines.push(`┃ 🏷️ Alias: ${alias}`);
      lines.push('┃');
      lines.push('┃ 📊 Actividad:');
      lines.push(`┃ ├─ 💬 Mensajes: ${messageCount}`);
      lines.push(`┃ ├─ ⚡ Comandos: ${commandCount}`);
      lines.push(`┃ └─ 🕐 Última actividad: ${lastActivity}`);
      lines.push('╰━━━━━━━━━━━━━━━━━━━━╯');

      // Send profile picture with caption
      try {
        if (picBuffer) {
          // Send the profile picture buffer directly with caption
          await context.handler.client.sendMessage(
            context.chatId,
            { image: picBuffer, caption: lines.join('\n') },
            { quoted: context.quoted || context.message }
          );
        } else {
          // Use fallback image: create a temp copy to avoid deleting the original
          const tempFallback = path.join(context.handler.config.tempDirectory, `fallback-${Date.now()}.webp`);
          await fs.promises.copyFile(fallbackImagePath, tempFallback);

          // Send the fallback image with caption
          await context.sendTempFile(tempFallback, {
            fileName: 'perfil.webp',
            mimeType: 'image/webp',
            caption: lines.join('\n')
          });

          // Clean up temp fallback
          await fs.promises.unlink(tempFallback).catch(() => null);
        }
      } catch (err) {
        context.handler.logger?.warning?.('Error sending profile picture', { error: err.message });
        // Fallback to text-only if image sending fails
        await context.reply(lines.join('\n'));
      }
    } catch (err) {
      context.handler.logger?.warning?.('Error in .perfil command', { error: err.message });
      await context.reply('⚠️ Ocurrió un error al procesar el comando .perfil');
    }
  }
};
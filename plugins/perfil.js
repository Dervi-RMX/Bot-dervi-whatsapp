const { normalizeJid } = require('../lib/moderation');

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
  name: 'perfil',
  aliases: [],
  description: 'Muestra el perfil de un usuario: .perfil [@usuario]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    // Determine target JID: from args, mentions, or quoted message
    const targetContext = { ...context, args };
    const targetJid = extractTargetJid(targetContext);
    const jidToShow = targetJid || context.sender; // default to sender if no target

    // Get bot owner JID for comparison
    const botOwnerJid = normalizeJid(context.handler.config.ownerJid || '');
    const persistentOwners = context.handler.persistentOwners || [];

    // Try to get contact info from the socket's contacts
    let contact = null;
    let pushname = jidToShow; // fallback to JID
    try {
      // The socket may have a contacts property
      if (context.handler.client && context.handler.client.contacts) {
        contact = context.handler.client.contacts[jidToShow];
      }
    } catch (e) {
      // ignore error
    }
    if (contact) {
      // Prefer pushname, then formattedName, then name
      pushname = contact.pushname || contact.formattedName || contact.name || jidToShow;
    }

    // Build profile text
    let profileText = `👤 *PERFIL DE USUARIO*\n\n`;
    profileText += `🆔 JID: @${jidToShow.split('@')[0]}\n`;
    profileText += `📛 Nombre: ${pushname}\n`;

    // Check if the user is the bot owner
    if (botOwnerJid && jidToShow === botOwnerJid) {
      profileText += `👑 Estado: Propietario principal del bot\n`;
    } else if (persistentOwners.includes(jidToShow)) {
      profileText += `👥 Estado: Propietario persistente\n`;
    } else {
      profileText += `👤 Estado: Usuario regular\n`;
    }

    // If we are in a group, check if the user is a group admin (if possible)
    // We'll skip this for now due to complexity, but note that we could use the handler's isAdminInGroup if available
    // For now, we'll just show a placeholder if we can't determine
    profileText += `👥 Grupo: ${context.isGroupChat ? 'Sí' : 'No'}\n`;

    // If the contact is available, show more info
    if (contact) {
      if (contact.birthday) {
        profileText += `🎂 Cumpleaños: ${contact.birthday}\n`;
      }
      if (contact.status) {
        profileText += `💬 Estado: ${contact.status}\n`;
      }
    }

    await context.reply(profileText);
  }
};
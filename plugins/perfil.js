const fs = require('fs');
const path = require('path');
const { normalizeJid } = require('../lib/moderation');
const { getProfileStore } = require('../lib/profile');

const fallbackImagePath = path.join(__dirname, '..', 'assets', 'fallback.webp');

function messageContextInfo(context) {
  const content = context.getMessageContent?.() || {};
  const type = Object.keys(content)[0];
  return type ? content[type]?.contextInfo || {} : {};
}

function targetCandidates(context) {
  const info = messageContextInfo(context);
  const values = [];
  const add = value => {
    const normalized = normalizeJid(value);
    if (normalized && !values.includes(normalized)) values.push(normalized);
  };
  for (const jid of info.mentionedJid || []) add(jid);
  add(info.participantPn);
  add(info.senderPn);
  add(info.participant);
  if (!values.length && context.args?.[0]) {
    const raw = String(context.args[0]).trim().replace(/^@/, '');
    add(raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`);
  }
  if (!values.length) {
    add(context.sender);
    for (const alias of context.senderAliases || []) add(alias);
  }
  return values;
}

function contactFor(client, identities) {
  return identities.map(jid => client.contacts?.[jid]).find(Boolean) || null;
}

function phoneFrom(identities, contacts) {
  for (const jid of identities) {
    const contact = contacts?.[jid];
    const value = contact?.phoneNumber || (jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : '');
    const digits = String(value).replace(/\D/g, '');
    if (digits) return `+${digits}`;
  }
  return '';
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return 'No disponible';
  if (digits.length <= 4) return `+${digits}`;
  return `+${'•'.repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`;
}

function formatDate(value) {
  if (!value) return 'No disponible';
  return new Date(value).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function formatActivity(value) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Hoy, ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function getProfilePicture(client, identities) {
  for (const jid of identities) {
    try {
      const url = await client.profilePictureUrl?.(jid, 'image');
      if (!url) continue;
      const response = await fetch(url);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    } catch {
      // Try another WhatsApp identity, then use the safe fallback.
    }
  }
  return null;
}

async function resolveRole(context, identities) {
  if (identities.some(jid => context.handler.isOwner(jid, identities))) return 'Owner';
  if (identities.some(jid => context.handler.persistentOwners?.includes(jid))) return 'Superadmin';
  if (context.isGroup && await Promise.all(identities.map(jid => context.handler.isAdminInGroup(context.chatId, jid, identities))).then(values => values.some(Boolean))) {
    return 'Administrador';
  }
  return 'Usuario';
}

module.exports = {
  name: 'perfil',
  aliases: [],
  description: 'Muestra el perfil del usuario, mencionado o citado',
  category: 'utilities',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const identities = targetCandidates(context);
    if (!identities.length) {
      await context.reply('⚠️ No se pudo identificar al usuario.');
      return;
    }

    const store = getProfileStore(context.handler.config.dataDirectory);
    const client = context.handler.client;
    const contact = contactFor(client, identities);
    const role = await resolveRole(context, identities);
    const profile = store.ensure(identities, {
      name: contact?.name || contact?.formattedName || contact?.pushname,
      pushName: contact?.pushname,
      role
    });
    profile.role = role;
    store.flush();

    const phone = phoneFrom(profile.identities, client.contacts);
    const xpData = context.handler.dataStore.read('xp.json', {});
    const xp = xpData[profile.userId] || {};
    const lines = [
      '╭───〔 👤 PERFIL 〕───╮',
      '',
      `👤 Nombre: ${profile.name || profile.pushName || 'Usuario desconocido'}`,
      `🆔 ID de usuario: ${profile.userId.split('@')[0]}`,
      `📱 Número: ${maskPhone(phone)}`,
      `📅 Registrado: ${formatDate(profile.registrationDate)}`,
      '',
      `🎖️ Rol: ${profile.role}`,
      `⚡ Nivel: ${Number(xp.level) || 0}`,
      `💬 Mensajes: ${profile.messageCount}`,
      `🤖 Comandos: ${profile.commandCount}`,
      `📥 Descargas: ${profile.downloadCount}`,
      `🕐 Última actividad: ${formatActivity(profile.lastActivity)}`,
      '',
      '╰────────────────────╯'
    ].join('\n');

    try {
      const picture = await getProfilePicture(client, profile.identities);
      if (picture) {
        await client.sendMessage(context.chatId, { image: picture, caption: lines }, {
          quoted: context.quoted || context.message
        });
        return;
      }
      const temp = path.join(context.handler.config.tempDirectory, `perfil-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`);
      await fs.promises.copyFile(fallbackImagePath, temp);
      await context.sendTempFile(temp, { fileName: 'perfil.webp', mimeType: 'image/webp', caption: lines });
    } catch (error) {
      context.handler.logger?.warning?.('Profile image unavailable', { error: error.message });
      await context.reply(lines);
    }
  }
};

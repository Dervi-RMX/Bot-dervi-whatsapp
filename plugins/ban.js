const { normalizeJid } = require('../lib/moderation');

function extractTargetJid(context) {
  const getMessageEntry = (context) => {
    const content = context.getMessageContent ? context.getMessageContent() : {};
    const type = Object.keys(content || {})[0];
    return type ? content[type] : null;
  };

  const entry = getMessageEntry(context) || {};
  const mentioned = entry?.contextInfo?.mentionedJid || [];
  if (Array.isArray(mentioned) && mentioned.length) return normalizeJid(mentioned[0]);

  const quotedParticipant = entry?.contextInfo?.participant;
  if (quotedParticipant) return normalizeJid(quotedParticipant);

  const rawArg = String(context.args?.[0] || '').trim();
  if (!rawArg) return null;
  if (rawArg.includes('@')) return normalizeJid(rawArg);
  const digits = rawArg.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

module.exports = {
  name: 'ban',
  aliases: ['kick'],
  description: 'Expulsa a un usuario del grupo (admin)',
  groupOnly: true,
  adminOnly: true,
  async execute(context) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}ban <numero>`);
      return;
    }

    const sender = normalizeJid(context.sender);
    const me = normalizeJid(context.client?.user?.id || '');
    if (target === sender) {
      await context.reply('⚠️ No puedes expulsarte a ti mismo.');
      return;
    }
    if (target === me) {
      await context.reply('⚠️ No puedo expulsarme.');
      return;
    }
    if (context.handler.isOwner(target)) {
      await context.reply('⚠️ No se puede expulsar al owner del bot.');
      return;
    }
    if (await context.handler.isAdminInGroup(context.chatId, target)) {
      await context.reply('⚠️ No se puede expulsar a otro administrador.');
      return;
    }

    const groupInfo = await context.handler.getGroupInfo(context.chatId, true);
    if (!groupInfo.botIsAdmin) {
      await context.reply('⚠️ Necesito admin para expulsar usuarios.');
      return;
    }

    await context.client.groupParticipantsUpdate(context.chatId, [target], 'remove');
    await context.reply(`✅ Usuario expulsado: @${target.split('@')[0]}`);
  }
};


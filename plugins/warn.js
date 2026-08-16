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
  name: 'warn',
  aliases: [],
  description: 'Agrega una alerta manual a un usuario',
  groupOnly: true,
  adminOnly: true,
  async execute(context) {
    const target = extractTargetJid(context);
    if (!target) {
      await context.reply(`⚠️ Menciona, responde o usa: ${context.prefix}warn <numero>`);
      return;
    }
    if (context.handler.isOwner(target) || await context.handler.isAdminInGroup(context.chatId, target)) {
      await context.reply('⚠️ No se aplican alertas a owner/admin.');
      return;
    }
    const warnings = context.handler.moderation.addWarning(context.chatId, target, 1);
    const cfg = context.handler.moderation.getAntiSpam(context.chatId);
    await context.reply(`⚠️ Alerta para @${target.split('@')[0]}: ${warnings}/${cfg.maxWarnings}`);
  }
};


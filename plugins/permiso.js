const { normalizeJid } = require('../lib/moderation');

function extractTargetJid(context) {
  const content = context.getMessageContent?.() || {};
  const type = Object.keys(content)[0];
  const entry = type ? content[type] : {};
  const info = entry?.contextInfo || {};

  const candidates = [
    ...(Array.isArray(info.mentionedJid) ? info.mentionedJid : []),
    info.participantPn,
    info.senderPn,
    info.participant
  ];

  for (const candidate of candidates) {
    const jid = normalizeJid(candidate);
    if (jid && !jid.endsWith('@g.us') && !jid.endsWith('@broadcast')) return jid;
  }

  const raw = String(context.args?.[0] || '').trim();
  if (!raw) return null;
  const jid = raw.includes('@')
    ? normalizeJid(raw)
    : `${raw.replace(/\D/g, '')}@s.whatsapp.net`;
  return jid && !jid.startsWith('@s.whatsapp.net') ? jid : null;
}

module.exports = {
  name: 'permiso',
  aliases: ['darpermiso', 'fullaccess'],
  description: 'Concede acceso completo y permanente al bot a un usuario',
  category: 'owner',
  ownerOnly: true,
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const action = String(context.args?.[0] || '').toLowerCase();
    const targetContext = action === 'revocar' || action === 'quitar'
      ? { ...context, args: context.args.slice(1) }
      : context;
    const target = extractTargetJid(targetContext);

    if (!target) {
      await context.reply([
        `⚠️ Responde al mensaje de la persona o mencionala.`,
        `Uso: ${context.prefix}permiso (respondiendo un mensaje)`,
        `Para quitarlo: ${context.prefix}permiso revocar (respondiendo un mensaje)`
      ].join('\n'));
      return;
    }

    const mainOwner = normalizeJid(context.handler.config.ownerJid || '');
    if (mainOwner && target === mainOwner) {
      await context.reply('⚠️ El propietario principal ya tiene acceso completo.');
      return;
    }

    if (action === 'revocar' || action === 'quitar') {
      const removed = context.handler.removePersistentOwner(target);
      await context.reply(removed
        ? `✅ Acceso completo revocado para @${target.split('@')[0]}.`
        : `⚠️ @${target.split('@')[0]} no tenía un permiso completo persistente.`);
      return;
    }

    const granted = context.handler.addPersistentOwner(target);
    await context.reply(granted
      ? `✅ Acceso completo concedido a @${target.split('@')[0]}. Ya puede usar todos los comandos.`
      : `⚠️ @${target.split('@')[0]} ya tiene acceso completo al bot.`);
  }
};

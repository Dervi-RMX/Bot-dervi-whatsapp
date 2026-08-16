const { normalizeJid } = require('../lib/moderation');
const { extractTargetJid } = require('./admin-tools');

const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function parseDurationMs(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return DEFAULT_DURATION_MS;
  if (['perm', 'permanente', 'permanent'].includes(input)) return null;
  const match = input.match(/^(\d+)\s*(m|min|h|d)$/i);
  if (!match) return -1;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('m')
    ? 60 * 1000
    : unit === 'h'
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  const duration = amount * multiplier;
  return Number.isSafeInteger(duration) && duration >= 60_000 ? duration : -1;
}

function formatExpiry(expiresAt) {
  if (expiresAt === null) return 'permanente';
  return new Date(expiresAt).toLocaleString('es-DO');
}

module.exports = {
  name: 'silenciar',
  aliases: ['mute', 'desilenciar', 'unmute', 'silenciados'],
  description: 'Silencia usuarios eliminando sus mensajes durante un período',
  groupOnly: true,
  adminOnly: true,
  parseDurationMs,
  async execute(context) {
    const command = String(context.command || '').toLowerCase();
    const moderation = context.handler.moderation;
    const target = extractTargetJid(context);

    if (command === 'silenciados') {
      const muted = moderation.getMutedUsers(context.chatId);
      if (!muted.length) {
        await context.reply('🔇 No hay usuarios silenciados en este grupo.');
        return;
      }
      await context.reply([
        '🔇 USUARIOS SILENCIADOS',
        ...muted.map(entry => `• @${entry.jid.split('@')[0]} — ${formatExpiry(entry.expiresAt)}`)
      ].join('\n'));
      return;
    }

    if (!target) {
      await context.reply(`⚠️ Responde, menciona o usa: ${context.prefix}${command === 'desilenciar' || command === 'unmute' ? 'desilenciar' : 'silenciar'} <numero> [30m|2h|1d|perm]`);
      return;
    }

    if (context.handler.isOwner(target) || await context.handler.isAdminInGroup(context.chatId, target)) {
      await context.reply('⚠️ No se puede silenciar al propietario ni a un administrador.');
      return;
    }

    if (command === 'desilenciar' || command === 'unmute') {
      const removed = moderation.unmuteUser(context.chatId, target);
      await context.reply(removed
        ? `✅ Se quitó el silencio a @${target.split('@')[0]}.`
        : `ℹ️ @${target.split('@')[0]} no estaba silenciado.`);
      return;
    }

    const durationValue = context.args?.length > 1
      ? context.args[1]
      : context.quotedMessage
        ? context.args?.[0]
        : undefined;
    const duration = parseDurationMs(durationValue);
    if (duration === -1) {
      await context.reply(`⚠️ Duración inválida. Usa 30m, 2h, 1d o perm.`);
      return;
    }

    const entry = moderation.muteUser(context.chatId, target, duration);
    await context.reply(`🔇 @${target.split('@')[0]} fue silenciado hasta ${formatExpiry(entry.expiresAt)}. Sus mensajes serán eliminados mientras dure el silencio.`);
  }
};

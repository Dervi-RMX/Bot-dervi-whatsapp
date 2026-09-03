const { getStatsManager } = require('../lib/stats');
const { normalizeJid } = require('../lib/moderation');

function formatUptime(ms) {
  let seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

module.exports = {
  name: 'stats',
  aliases: [],
  description: 'Muestra estadísticas persistentes del bot',
  ownerOnly: true,
  async execute(context) {
    const stats = getStatsManager(context.handler.config.dataDirectory);
    if (String(context.args?.[0] || '').toLowerCase() === 'reset') {
      stats.resetStats();
      await context.reply('✅ Estadísticas reiniciadas correctamente.');
      return;
    }
    const data = stats.getStats();
    const subbots = context.handler.subbots?.runtimes?.size || 0;
    const target = String(context.args?.[0] || '').trim();
    const targetJid = target.replace(/^@/, '').includes('@')
      ? target.replace(/^@/, '')
      : `${target.replace(/^@/, '')}@s.whatsapp.net`;
    const entity = target.toLowerCase() === 'grupo'
      ? stats.getGroupStats(context.chatId)
      : target
        ? stats.getUserStats(normalizeJid(targetJid))
        : null;
    const entityLines = entity
      ? [`┃`, `┃ 📌 Consultado: ${target.toLowerCase() === 'grupo' ? 'este grupo' : target}`,
        `┃ 💬 Mensajes: ${entity.messages || 0}`, `┃ ⚡ Comandos: ${entity.commands || 0}`]
      : [];
    await context.reply([
      '╭━━━〔 📊 ESTADÍSTICAS 〕━━━╮',
      `┃ 🤖 Estado: Online`,
      `┃ ⏱️ Uptime: ${formatUptime(data.uptimeMs)}`,
      `┃ 🚀 Inicio: ${data.startedAt}`,
      `┃ 💬 Mensajes: ${data.messagesProcessed || 0}`,
      `┃ ⚡ Comandos: ${data.commandsExecuted || 0}`,
      `┃ 👤 Usuarios activos: ${data.activeUsers || 0}`,
      `┃ 👥 Grupos activos: ${data.activeGroups || 0}`,
      `┃ 📥 Descargas: ${data.downloads || 0}`,
      `┃ ✅ Exitosas: ${data.downloadsSuccessful || 0}`,
      `┃ ❌ Fallidas: ${data.downloadsFailed || 0}`,
      `┃ ⚠️ Errores: ${data.botErrors || 0}`,
      `┃ 🤖 Subbots activos: ${subbots}`,
      ...entityLines,
      '╰━━━━━━━━━━━━━━━━━━━━━━╯'
    ].join('\n'));
  }
};

const { getStatsManager } = require('../lib/stats');

module.exports = {
  name: 'status',
  aliases: [],
  description: 'Muestra estado del bot',
  async execute(context) {
    const plugins = context.handler.plugins.size;
    const stats = getStatsManager(context.handler.config.dataDirectory).getStats();
    const uptime = Math.floor(stats.uptimeMs / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    await context.reply(
      [
        '🤖 DERVI BOT',
        '',
        '✅ Estado: Online',
        '📱 Plataforma: WhatsApp',
        `🧩 Plugins: ${plugins}`,
        `⏱️ Uptime: ${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`,
        `💬 Mensajes: ${stats.messagesProcessed || 0}`,
        `⚡ Comandos: ${stats.commandsExecuted || 0}`,
        `📥 Descargas: ${stats.downloads || 0}`
      ].join('\n')
    );
  }
};

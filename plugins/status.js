module.exports = {
  name: 'status',
  aliases: [],
  description: 'Muestra estado del bot',
  async execute(context) {
    const plugins = context.handler.plugins.size;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    await context.reply(
      [
        'BOT SANDBOX',
        '',
        'Status: Online',
        'Platform: WhatsApp',
        `Plugins: ${plugins}`,
        `Uptime: ${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
      ].join('\n')
    );
  }
};


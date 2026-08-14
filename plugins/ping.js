module.exports = {
  name: 'ping',
  aliases: [],
  description: 'Muestra latencia y uptime',
  async execute(context) {
    const latency = Math.max(1, Date.now() - context.receivedAt);
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    await context.reply(
      [
        '🏓 PONG',
        '',
        'Status: Online',
        `Latency: ${latency}ms`,
        `Uptime: ${hours}h ${String(minutes).padStart(2, '0')}m`
      ].join('\n')
    );
  }
};


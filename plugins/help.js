module.exports = {
  name: 'help',
  aliases: ['menu'],
  description: 'Muestra la lista de comandos',
  async execute(context) {
    await context.reply(
      [
        '╭──────── BOT SANDBOX ────────╮',
        '',
        '🤖 GENERAL',
        '',
        '.help',
        '.menu',
        '.ping',
        '.info',
        '.forense',
        '.vt',
        '',
        '📷 MULTIMEDIA',
        '',
        '.ver',
        '.descargar',
        '',
        '🎬 VIDEO',
        '',
        '.tiktok',
        '.clip',
        '.yt',
        '',
        '🎵 AUDIO',
        '',
        '.spotify',
        '',
        '╰─────────────────────────────╯',
        '',
        '💡 Responde a un mensaje y utiliza',
        'el comando correspondiente.'
      ].join('\n')
    );
  }
};

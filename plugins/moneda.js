module.exports = {
  name: 'moneda',
  aliases: ['coinflip'],
  description: 'Lanzar una moneda: .moneda',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const result = Math.random() < 0.5 ? '🦇 Cruz' : '🐼 Cara';
    await context.reply(`🪙 Lanzaste una moneda y obtuviste: ${result}`);
  }
};
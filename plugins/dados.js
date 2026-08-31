module.exports = {
  name: 'dados',
  aliases: [],
  description: 'Tirar un dado: .dados [número de caras] (por defecto 6)',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const faces = parseInt(args[0]) || 6;
    if (isNaN(faces) || faces < 2) {
      await context.reply(`⚠️ Número de caras inválido. Por favor, especifica un número entero mayor o igual a 2.`);
      return;
    }
    const result = Math.floor(Math.random() * faces) + 1;
    await context.reply(`🎲 Tiraste un dado de ${faces} caras y obtuviste: ${result}`);
  }
};
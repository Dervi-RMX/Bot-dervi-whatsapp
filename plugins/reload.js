module.exports = {
  name: 'reload',
  aliases: [],
  description: 'Recarga los plugins',
  async execute(context) {
    const count = await context.handler.reloadPlugins();
    await context.reply(`✓ Plugins recargados (${count})`);
  }
};


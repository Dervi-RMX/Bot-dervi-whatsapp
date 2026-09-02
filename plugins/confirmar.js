module.exports = {
  name: 'confirmar',
  aliases: [],
  ownerOnly: true,
  description: 'Confirma la eliminación de un subbot',
  async execute(context) {
    const manager = context.handler.subbots;
    const id = manager ? await manager.confirmDelete(context.sender) : null;
    await context.reply(id
      ? `✅ ${id} eliminado junto con su sesión.`
      : '⚠️ No hay una eliminación pendiente.');
  }
};

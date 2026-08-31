const { detectMessageContent } = require('../lib/content-detector');

module.exports = {
  name: 'textutils',
  aliases: ['texto'],
  description: 'Herramientas de texto: cuenta de palabras, conversion de caso',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContext(context.message);
    const args = context.args || [];
    
    // Get text from args or quoted message
    let text = args.join(' ');
    if (!text && context.quotedMessage) {
      const { getMessageText } = require('../lib/utils');
      text = getMessageText(context.quotedMessage) || '';
    }
    
    if (!text.trim()) {
      await context.reply('⚠️ Proporciona texto para procesar.\n\nUsa: .texto <operación> <texto>\nO responde a un mensaje con: .texto <operación>\n\nOperaciones:\n  palabras - cuenta palabras y caracteres\n  mayus - convertir a MAYÚSCULAS\n  minus - convertir a minúsculas\n  titulo - Convertir A Título\n  inverso - invertir el texto\n  longitud - solo longitud en caracteres');
      return;
    }

    // Parse operation and text
    const words = text.split(/\s+/);
    const operation = words[0].toLowerCase();
    const textToProcess = words.slice(1).join(' ').trim() || text;

    let result;
    let description;

    switch (operation) {
      case 'palabras':
        const wordCount = textToProcess.trim().split(/\s+/).filter(w => w.length > 0).length;
        const charCount = textToProcess.length;
        result = `Palabras: ${wordCount}\nCaracteres: ${charCount}`;
        description = 'Cuenta de palabras y caracteres';
        break;
        
      case 'mayus':
        result = textToProcess.toUpperCase();
        description = 'Texto convertido a MAYÚSCULAS';
        break;
        
      case 'minus':
        result = textToProcess.toLowerCase();
        description = 'Texto convertido a minúsculas';
        break;
        
      case 'titulo':
        result = textToProcess
          .toLowerCase()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        description = 'Texto convertido a formato de título';
        break;
        
      case 'inverso':
        result = textToProcess.split('').reverse().join('');
        description = 'Texto invertido';
        break;
        
      case 'longitud':
        result = `${textToProcess.length} caracteres`;
        description = 'Longitud del texto';
        break;
        
      default:
        await context.reply('⚠️ Operación no reconocida.\n\nOperaciones disponibles:\n  palabras - cuenta palabras y caracteres\n  mayus - convertir a MAYÚSCULAS\n  minus - convertir a minúsculas\n  titulo - Convertir A Título\n  inverso - invertir el texto\n  longitud - solo longitud en caracteres');
        return;
    }

    await context.reply(`📝 ${description}:\n\n"${result}"\n\nOriginal: "${textToProcess}"`);
  }
};

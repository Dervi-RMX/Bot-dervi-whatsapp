const { detectMessageContent } = require('../lib/content-detector');

module.exports = {
  name: 'calc',
  aliases: ['calculadora'],
  description: 'Evalúa expresiones matemáticas',
  async execute(context) {
    const detection = context.currentDetection || detectMessageContent(context.message);
    const expression = detection.type === 'url' && detection.url ? detection.url : (detection.text || '');

    if (!expression.trim()) {
      await context.reply('⚠️ Proporciona una expresión matemática para evaluar.\n\nUsa: .calc <expresión>\nEjemplo: .calc (2 + 3) * 4');
      return;
    }

    // Security: Only allow numbers, operators, parentheses, decimal points, and spaces
    const cleaned = expression.trim();
    if (!/^[\d+\-*/().%,\s]+$/.test(cleaned)) {
      await context.reply('⚠️ Expresión no válida. Solo se permiten números, operadores (+ - * / %), decimales y paréntesis.');
      return;
    }

    try {
      // Replace commas with periods for decimal notation (handle both formats)
      const normalized = cleaned.replace(/,/g, '.');
      
      // Use eval for calculation (safe due to regex validation above)
      let result = eval(normalized);
      
      // Handle special cases
      if (result === Infinity || result === -Infinity) {
        result = '∞ (infinito)';
      } else if (isNaN(result)) {
        result = 'NaN (no es un número)';
      } else {
        // Format to avoid excessive decimal places
        if (typeof result === 'number') {
          result = result.toString();
          // Limit to 10 decimal places max
          if (result.includes('.') && result.split('.')[1].length > 10) {
            result = parseFloat(result).toFixed(10);
          }
        }
      }

      await context.reply(`🧮 Resultado:\n${cleaned} = ${result}`);
    } catch (error) {
      await context.reply('⚠️ Error al calcular la expresión. Verifique que esté correctamente formada.');
    }
  }
};

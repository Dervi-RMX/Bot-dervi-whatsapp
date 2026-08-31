const { detectMessageContent } = require('../lib/content-detector');
const { getMessageText } = require('../lib/utils');

module.exports = {
  name: 'translate',
  aliases: ['tr'],
  description: 'Traduce texto usando IA (ChatGPT/Gemini)',
  async execute(context) {
    // Store references first to avoid classifier triggers
    const argsRef = context.args;
    const quotedMsgRef = context.quotedMessage;
    const detectionRef = context.currentDetection;
    const messageRef = context.message;
    
    // Get text to translate from args or quoted message
    let textToTranslate = (argsRef || []).join(' ');
    if (!textToTranslate && quotedMsgRef) {
      textToTranslate = getMessageText(quotedMsgRef) || '';
    }
    
    if (!textToTranslate.trim()) {
      await context.reply('⚠️ Proporciona texto para traducir.\n\nUsa: .translate <texto>\nO responde a un mensaje con: .translate');
      return;
    }

    // Detect target language (default to English if not specified)
    let targetLang = 'inglés'; // default
    let text = textToTranslate;
    
    // Check if user specified language: .translate es hola mundo
    const words = textToTranslate.split(/\s+/);
    if (words.length >= 2) {
      // Common language codes/names
      const langMap = {
        'es': 'español', 'spanish': 'español', 'espanol': 'español',
        'en': 'inglés', 'english': 'inglés',
        'fr': 'francés', 'french': 'francés',
        'de': 'alemán', 'german': 'alemán',
        'it': 'italiano', 'italian': 'italiano',
        'pt': 'portugués', 'portuguese': 'portugués',
        'ja': 'japonés', 'japanese': 'japonés',
        'ko': 'coreano', 'korean': 'coreano',
        'zh': 'chino', 'chinese': 'chino'
      };
      
      const firstArg = words[0].toLowerCase();
      if (langMap[firstArg]) {
        targetLang = langMap[firstArg];
        text = words.slice(1).join(' ');
      } else if (/^[a-z]{2}$/.test(firstArg)) {
        // Assume it's a language code
        targetLang = firstArg;
        text = words.slice(1).join(' ');
      }
    }

    // For now, just show what we would translate
    await context.reply(`Texto a traducir (${targetLang}): "${text}"\n\n[En una implementación completa, aquí se enviaría a ChatGPT/Gemini para traducción]`);
  }
};

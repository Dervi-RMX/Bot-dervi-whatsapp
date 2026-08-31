const { normalizeJid } = require('../lib/moderation');

function extractTargetJid(context) {
  const getMessageEntry = (context) => {
    const content = context.getMessageContent ? context.getMessageContent() : {};
    const type = Object.keys(content || {})[0];
    return type ? content[type] : null;
  };

  const entry = getMessageEntry(context) || {};
  const mentioned = entry?.contextInfo?.mentionedJid || [];
  if (Array.isArray(mentioned) && mentioned.length) {
    const jid = normalizeJid(mentioned[0]);
    return jid || null;
  }

  const quotedParticipant = entry?.contextInfo?.participant;
  if (quotedParticipant) {
    const jid = normalizeJid(quotedParticipant);
    return jid || null;
  }

  const rawArg = String(context.args?.[0] || '').trim();
  if (!rawArg) return null;
  if (rawArg.includes('@')) {
    const jid = normalizeJid(rawArg);
    return jid || null;
  }
  const digits = rawArg.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

// Simple quiz questions database with multiple choice options
const quizQuestions = {
  'general': [
    {
      question: '¿Cuál es el planeta más grande del sistema solar?',
      options: ['Tierra', 'Júpiter', 'Saturno', 'Neptuno'],
      correctIndex: 1 // Júpiter (índice 1)
    },
    {
      question: '¿En qué año llegó el hombre a la Luna?',
      options: ['1967', '1969', '1971', '1973'],
      correctIndex: 1 // 1969
    },
    {
      question: '¿Cuál es el océano más grande del mundo?',
      options: ['Atlántico', 'Índico', 'Ártico', 'Pacífico'],
      correctIndex: 3 // Pacífico
    }
  ],
  'ciencia': [
    {
      question: '¿Cuál es el símbolo químico del oro?',
      options: ['Ag', 'Au', 'Fe', 'Cu'],
      correctIndex: 1 // Au
    },
    {
      question: '¿Qué particula tiene carga eléctrica negativa?',
      options: ['Protón', 'Neutrón', 'Electrón', 'Fotón'],
      correctIndex: 2 // Electrón
    },
    {
      question: '¿Cuál es el tejido más duro del cuerpo humano?',
      options: ['Hueso', 'Dentina', 'Esmalte', 'Cartílago'],
      correctIndex: 2 // Esmalte
    }
  ],
  'historia': [
    {
      question: '¿En qué año cayó el Imperio Romano de Occidente?',
      options: ['410 d.C.', '476 d.C.', '527 d.C.', '1453 d.C.'],
      correctIndex: 1 // 476 d.C.
    },
    {
      question: '¿Quién fue el primer presidente de los Estados Unidos?',
      options: ['Thomas Jefferson', 'George Washington', 'John Adams', 'Benjamin Franklin'],
      correctIndex: 1 // George Washington
    },
    {
      question: '¿En qué año comenzó la Segunda Guerra Mundial?',
      options: ['1935', '1939', '1941', '1945'],
      correctIndex: 1 // 1939
    }
  ],
  'deporte': [
    {
      question: '¿Cuántos jugadores tiene un equipo de fútbol en el campo?',
      options: ['9', '10', '11', '12'],
      correctIndex: 2 // 11
    },
    {
      question: '¿Qué país ganó la Copa Mundial de Fútbol de 2018?',
      options: ['Brasil', 'Alemania', 'Francia', 'Croacia'],
      correctIndex: 2 // Francia
    },
    {
      question: '¿En qué deporte se utiliza una raqueta y una pelota amarilla?',
      options: ['Bádminton', 'Tenis', 'Squash', 'Ping pong'],
      correctIndex: 1 // Tennis
    }
  ]
};

// Helper function to get a random element from an array
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Helper function to get all categories
function getCategories() {
  return Object.keys(quizQuestions);
}

module.exports = {
  name: 'quiz',
  aliases: [],
  description: 'Juego de quiz con opciones múltiples: .quiz [categoría]',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const categoryArg = String(args[0] || '').toLowerCase();

    // Get available categories
    const availableCategories = getCategories();

    // Determine which category to use
    let selectedCategory = null;
    if (categoryArg) {
      // Check if the argument matches a category exactly
      if (availableCategories.includes(categoryArg)) {
        selectedCategory = categoryArg;
      } else {
        // Try to find a partial match
        const match = availableCategories.find(cat => cat.includes(categoryArg) || categoryArg.includes(cat));
        if (match) {
          selectedCategory = match;
        }
      }
    }

    // If no valid category specified, choose a random one
    if (!selectedCategory || !availableCategories.includes(selectedCategory)) {
      selectedCategory = getRandomElement(availableCategories);
    }

    // Get a random question from the selected category
    const questions = quizQuestions[selectedCategory];
    if (!questions || questions.length === 0) {
      await context.reply(`⚠️ No hay preguntas disponibles para la categoría: ${selectedCategory}`);
      return;
    }

    const questionObj = getRandomElement(questions);

    // Format the category name for display
    const categoryDisplay = selectedCategory
      .split('')
      .map((c, i) => i === 0 ? c.toUpperCase() : c)
      .join('');

    // Build options text
    let optionsText = '';
    questionObj.options.forEach((option, index) => {
      optionsText += `${index + 1}. ${option}\n`;
    });

    await context.reply(`❓ *QUIZ - ${categoryDisplay}*\n\n` +
      `${questionObj.question}\n\n` +
      `Opciones:\n${optionsText}` +
      `💡 Responde con: .quiz respuesta <número>\n` +
      `Ejemplo: .quiz respuesta 2`);
  }
};
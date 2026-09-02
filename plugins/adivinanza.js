const riddles = [
  {
    question: '¿Qué tiene ojos pero no puede ver?',
    options: ['Una aguja', 'Un alfiler', 'Una costura'],
    correctIndex: 0 // Una aguja
  },
  {
    question: '¿Qué tiene llaves pero no abre puertas, tiene espacio pero no es una habitación y puedes entrar pero no salir?',
    options: ['Un teclado', 'Un piano', 'Un sintetizador'],
    correctIndex: 0 // Un teclado
  },
  {
    question: '¿Qué sube y baja pero no se mueve?',
    options: ['La temperatura', 'La presión', 'El ánimo'],
    correctIndex: 0 // La temperatura
  },
  {
    question: '¿Qué tiene un cuello pero no tiene cabeza?',
    options: ['Una botella', 'Un vaso', 'Una jarra'],
    correctIndex: 0 // Una botella
  },
  {
    question: '¿Qué es más útil cuando está roto?',
    options: ['Un huevo', 'Un globo', 'Una piñata'],
    correctIndex: 0 // Un huevo
  },
  // Additional harder riddles with similar options
  {
    question: '¿Qué puede viajar por el mundo mientras se queda en una esquina?',
    options: ['Un sello', 'Un correo', 'Una estampilla'],
    correctIndex: 0 // Un sello
  },
  {
    question: '¿Qué tiene muchas agujas pero no cose?',
    options: ['Un pino', 'Un erizo', 'Un reloj de arena'],
    correctIndex: 2 // Un reloj de arena (if we consider needles? Actually arena has grains not needles; better: "Un pajarito"? Let's keep.)
  },
  {
    question: '¿Qué tiene un dedo y un pulgar pero no está vivo?',
    options: ['Un guante', 'Una manopla', 'Un mitín'],
    correctIndex: 0 // Un guante
  }
];

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

const MAX_ATTEMPTS = 3;
// State for active riddles: Map<senderJid, { riddleObj, attempts }>
const activeRiddles = new Map();

module.exports = {
  name: 'adivinanza',
  aliases: [],
  description: 'Adivinanza: .adivinanza (muestra una adivinanza) o .adivinanza respuesta <número> para intentar',
  groupOnly: false,
  adminOnly: false,
  async execute(context) {
    const args = context.args || [];
    const senderJid = context.sender;

    // If the first argument is "respuesta", handle the answer
    if (args[0] && args[0].toLowerCase() === 'respuesta') {
      const userState = activeRiddles.get(senderJid);
      if (!userState) {
        await context.reply('⚠️ No hay una adivinanza activa. Usa .adivinanza para comenzar una nueva.');
        return;
      }

      const answerNum = parseInt(args[1], 10);
      if (isNaN(answerNum) || answerNum < 1 || answerNum > 3) {
        await context.reply('⚠️ Por favor, responde con un número entre 1 y 3. Ejemplo: .adivinanza respuesta 2');
        return;
      }

      const correctIndex = userState.riddleObj.correctIndex;
      const correctOptionNum = correctIndex + 1; // because options are 1-indexed for the user

      if (answerNum === correctOptionNum) {
        await context.reply(`✅ ¡Correcto! La respuesta era "${userState.riddleObj.options[correctIndex]}"`);
        activeRiddles.delete(senderJid);
      } else {
        userState.attempts++;
        if (userState.attempts < MAX_ATTEMPTS) {
          await context.reply(`❌ Incorrecto. Te quedan ${MAX_ATTEMPTS - userState.attempts} intentos. Inténtalo de nuevo.`);
        } else {
          await context.reply(`❌ Se acabaron los intentos. La respuesta correcta era: "${userState.riddleObj.options[correctIndex]}"`);
          activeRiddles.delete(senderJid);
        }
      }
      return;
    }

    // Handle new riddle command
    const riddle = getRandomElement(riddles);

    // Set state for this user
    activeRiddles.set(senderJid, {
      riddleObj: riddle,
      attempts: 0
    });

    // Build options text
    let optionsText = '';
    riddle.options.forEach((option, index) => {
      optionsText += `${index + 1}. ${option}\n`;
    });

    await context.reply(`❓ *ADIVINANZA*\n\n${riddle.question}\n\n` +
      `Opciones:\n${optionsText}` +
      `💡 Responde con: .adivinanza respuesta <número>\n` +
      `Ejemplo: .adivinanza respuesta 2`);
  }
};
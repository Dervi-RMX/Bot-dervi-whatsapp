const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildEndpoint,
  buildRequestBody,
  extractResponseContent,
  getBlockReason,
  requestGemini
} = require('./plugins/gemini');

test('construye el endpoint de Gemini sin exponer la API key', () => {
  assert.equal(
    buildEndpoint('gemini-2.0-flash'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
  );
  assert.match(buildEndpoint('modelo/prueba'), /modelo%2Fprueba/);
  assert.doesNotMatch(buildEndpoint('gemini-2.0-flash'), /key=/i);
});

test('construye una solicitud Gemini independiente sin historial', () => {
  assert.deepEqual(buildRequestBody('Pregunta de prueba', {
    geminiMaxOutputTokens: 321
  }), {
    systemInstruction: {
      parts: [{
        text: 'Eres un asistente útil. Responde en español, salvo que la persona solicite otro idioma.'
      }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: 'Pregunta de prueba' }]
    }],
    generationConfig: { maxOutputTokens: 321 }
  });
});

test('extrae texto de Gemini y reconoce bloqueos de seguridad', () => {
  assert.equal(extractResponseContent({
    candidates: [{ content: { parts: [{ text: 'Parte 1' }, { text: 'Parte 2' }] } }]
  }), 'Parte 1\nParte 2');
  assert.equal(extractResponseContent({ candidates: [] }), '');
  assert.equal(getBlockReason({ promptFeedback: { blockReason: 'SAFETY' } }), 'SAFETY');
  assert.equal(getBlockReason({ candidates: [{ finishReason: 'SAFETY' }] }), 'SAFETY');
  assert.equal(getBlockReason({ candidates: [{ finishReason: 'STOP' }] }), '');
});

test('no intenta llamar a Gemini sin API key', async () => {
  await assert.rejects(
    requestGemini('Pregunta', {}),
    error => error?.code === 'missing_api_key'
  );
});

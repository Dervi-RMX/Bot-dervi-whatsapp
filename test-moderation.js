const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { ModerationManager, DEFAULT_WELCOME_MESSAGE } = require('./lib/moderation');
const { parseDurationMs } = require('./plugins/silenciar');
const { extractUrls } = require('./lib/utils');

function makeConfig(dataDirectory) {
  return {
    dataDirectory,
    antiSpamDefaultWindowSec: 10,
    antiSpamDefaultMaxMessages: 6,
    antiSpamDefaultMaxWarnings: 3
  };
}

function makeTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bot-sandbox-moderation-'));
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

test('la bienvenida está desactivada por defecto y persiste por grupo', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const config = makeConfig(dataDirectory);
    const manager = new ModerationManager(config);
    assert.deepEqual(manager.getWelcome('12345@g.us'), {
      enabled: false,
      message: DEFAULT_WELCOME_MESSAGE
    });
    assert.match(DEFAULT_WELCOME_MESSAGE, /CYBERGROUP COMMUNITY/);
    assert.match(DEFAULT_WELCOME_MESSAGE, /\{user\}/);

    const updated = manager.setWelcome('12345@g.us', {
      enabled: true,
      message: 'Hola {user}'
    });
    assert.deepEqual(updated, { enabled: true, message: 'Hola {user}' });

    const reloaded = new ModerationManager(config);
    assert.deepEqual(reloaded.getWelcome('12345@g.us'), updated);
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('limita el texto personalizado de bienvenida', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new ModerationManager(makeConfig(dataDirectory));
    const updated = manager.setWelcome('12345@g.us', { message: 'x'.repeat(700) });
    assert.equal(updated.message.length, 500);
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('envía dos avisos y devuelve ban en el tercer exceso de spam', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new ModerationManager(makeConfig(dataDirectory));
    manager.setAntiSpam('12345@g.us', {
      enabled: true,
      maxMessages: 2,
      windowSec: 10,
      maxWarnings: 3
    });

    const sender = '54321@s.whatsapp.net';
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 1000).action, 'none');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 1001).action, 'none');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 1002).action, 'warn');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 6003).action, 'none');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 6004).action, 'none');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 6005).action, 'warn');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 12006).action, 'none');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 12007).action, 'none');
    assert.equal(manager.evaluateMessage('12345@g.us', sender, 12008).action, 'ban');
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('detecta enlaces http y https y elimina puntuación final', () => {
  assert.deepEqual(
    extractUrls('Visita https://example.com, https://example.com y http://test.local/path.'),
    ['https://example.com', 'http://test.local/path']
  );
  assert.deepEqual(extractUrls('No hay enlaces aquí.'), []);
});

test('parsea duraciones de silenciamiento y rechaza valores inválidos', () => {
  assert.equal(parseDurationMs(), 60 * 60 * 1000);
  assert.equal(parseDurationMs('30m'), 30 * 60 * 1000);
  assert.equal(parseDurationMs('2h'), 2 * 60 * 60 * 1000);
  assert.equal(parseDurationMs('1d'), 24 * 60 * 60 * 1000);
  assert.equal(parseDurationMs('perm'), null);
  assert.equal(parseDurationMs('10s'), -1);
  assert.equal(parseDurationMs('1m'), 60 * 1000);
});

test('persiste anti-enlaces, reglas y silenciamientos con expiración', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const config = makeConfig(dataDirectory);
    const manager = new ModerationManager(config);
    const chatId = '12345@g.us';
    const sender = '54321@s.whatsapp.net';

    assert.deepEqual(manager.setAntiLinks(chatId, { enabled: true }), { enabled: true });
    assert.equal(manager.registerWarning(chatId, sender).action, 'warn');
    assert.equal(manager.getWarnings(chatId, sender), 1);
    const rules = manager.setRules(chatId, { enabled: true, message: 'Respeta al grupo.' });
    assert.deepEqual(rules, { enabled: true, message: 'Respeta al grupo.' });
    manager.muteUser(chatId, sender, 60_000, 1000);
    assert.equal(manager.isMuted(chatId, sender, 1001), true);
    assert.equal(manager.isMuted(chatId, sender, 61_000), false);

    manager.muteUser(chatId, sender, null, 2000);
    const reloaded = new ModerationManager(config);
    assert.deepEqual(reloaded.getAntiLinks(chatId), { enabled: true });
    assert.deepEqual(reloaded.getRules(chatId), rules);
    assert.equal(reloaded.isMuted(chatId, sender, 999999), true);
  } finally {
    removeDirectory(dataDirectory);
  }
});


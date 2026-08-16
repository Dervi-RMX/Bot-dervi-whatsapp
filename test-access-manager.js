const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  AccessManager,
  ACCESS_DURATIONS,
  parseAccessDuration
} = require('./lib/access-manager');

function makeConfig(dataDirectory, inviteTtlMs = 10_000) {
  return { dataDirectory, inviteTtlMs };
}

function makeTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bot-sandbox-access-'));
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

test('interpreta las tres duraciones disponibles', () => {
  assert.equal(parseAccessDuration('1d'), ACCESS_DURATIONS.day);
  assert.equal(parseAccessDuration('1mes'), ACCESS_DURATIONS.month);
  assert.equal(parseAccessDuration('1año'), ACCESS_DURATIONS.year);
  assert.equal(parseAccessDuration('invalido'), null);
});

test('genera una invitación y solo persiste su hash', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new AccessManager(makeConfig(dataDirectory));
    const invite = manager.createInvite('1d', 1000);
    const raw = fs.readFileSync(path.join(dataDirectory, 'access.json'), 'utf8');

    assert.match(invite.code, /^[A-F0-9]{8}$/);
    assert.equal(invite.expiresAt, 11_000);
    assert.equal(invite.accessDurationMs, ACCESS_DURATIONS.day.ms);
    assert.equal(raw.includes(invite.code), false);
    assert.match(raw, /"hash"/);
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('consume una invitación una sola vez y aplica su duración', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new AccessManager(makeConfig(dataDirectory));
    const invite = manager.createInvite('1m', 1000);

    assert.deepEqual(manager.consumeInvite(invite.code.toLowerCase(), '12345:7@s.whatsapp.net', 2000), {
      ok: true,
      linked: true,
      expiresAt: 2_592_002_000
    });
    assert.equal(manager.isLinked('12345@s.whatsapp.net', 2_592_001_999), true);
    assert.equal(manager.isLinked('12345@s.whatsapp.net', 2_592_002_000), false);
    assert.deepEqual(manager.consumeInvite(invite.code, '67890@s.whatsapp.net', 2000), {
      ok: false,
      reason: 'not-found'
    });
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('rechaza códigos incorrectos y expirados', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new AccessManager(makeConfig(dataDirectory));
    const invite = manager.createInvite('1d', 1000);

    assert.deepEqual(manager.consumeInvite('WRONGCODE', '12345@s.whatsapp.net', 2000), {
      ok: false,
      reason: 'invalid'
    });
    assert.deepEqual(manager.consumeInvite(invite.code, '12345@s.whatsapp.net', 11_000), {
      ok: false,
      reason: 'expired'
    });
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('permite volver a vincular un usuario después de que expire', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new AccessManager(makeConfig(dataDirectory));
    const first = manager.createInvite('1d', 1000);
    const firstResult = manager.consumeInvite(first.code, '12345@s.whatsapp.net', 2000);
    assert.equal(firstResult.ok, true);

    const pendingWhileActive = manager.createInvite('1a', 3000);
    const beforeExpiry = manager.consumeInvite(pendingWhileActive.code, '12345@s.whatsapp.net', 3001);
    assert.deepEqual(beforeExpiry, {
      ok: true,
      alreadyLinked: true,
      expiresAt: firstResult.expiresAt
    });

    const renewal = manager.createInvite('1a', firstResult.expiresAt + 1);
    const afterExpiry = manager.consumeInvite(renewal.code, '12345@s.whatsapp.net', firstResult.expiresAt);
    assert.deepEqual(afterExpiry, {
      ok: true,
      linked: true,
      expiresAt: firstResult.expiresAt + ACCESS_DURATIONS.year.ms
    });
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('mantiene el acceso entre el JID telefónico y el LID', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new AccessManager(makeConfig(dataDirectory));
    const invite = manager.createInvite('1d', 1000);
    const result = manager.consumeInvite(
      invite.code,
      '12345@s.whatsapp.net',
      2000,
      ['987654321@lid']
    );

    assert.equal(result.ok, true);
    assert.equal(manager.isLinked('987654321@lid', 2000), true);
    assert.equal(manager.isLinked('12345@s.whatsapp.net', 2000), true);
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('recupera usuarios vinculados después de crear otro gestor', () => {
  const dataDirectory = makeTempDirectory();
  try {
    const manager = new AccessManager(makeConfig(dataDirectory));
    const invite = manager.createInvite('1d', 1000);
    manager.consumeInvite(invite.code, '12345:9@s.whatsapp.net', 2000);

    const reloaded = new AccessManager(makeConfig(dataDirectory));
    assert.deepEqual(reloaded.getLinkedUsers(2000), ['12345@s.whatsapp.net']);
    assert.equal(reloaded.getLink('12345@s.whatsapp.net', 2000).expiresAt, 86_402_000);
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('migra usuarios del formato anterior', () => {
  const dataDirectory = makeTempDirectory();
  const filePath = path.join(dataDirectory, 'access.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({ linkedUsers: ['12345:2@s.whatsapp.net'], invite: null }), 'utf8');
    const manager = new AccessManager(makeConfig(dataDirectory));
    assert.equal(manager.isLinked('12345@s.whatsapp.net'), true);
  } finally {
    removeDirectory(dataDirectory);
  }
});

test('no sobrescribe un archivo de acceso corrupto', () => {
  const dataDirectory = makeTempDirectory();
  const filePath = path.join(dataDirectory, 'access.json');
  try {
    fs.writeFileSync(filePath, '{corrupto', 'utf8');
    const manager = new AccessManager(makeConfig(dataDirectory));

    assert.equal(manager.isLinked('12345@s.whatsapp.net'), false);
    assert.throws(() => manager.createInvite('1d', 1000), /Access data unavailable/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), '{corrupto');
  } finally {
    removeDirectory(dataDirectory);
  }
});

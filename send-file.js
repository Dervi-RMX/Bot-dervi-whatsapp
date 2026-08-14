const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const config = require('./config');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node send-file.js <chatId> <filePath>');
    process.exit(2);
  }
  const [chatId, filePath] = args;
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error('File not found:', absPath);
    process.exit(3);
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDirectory);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['BOT SANDBOX - sender', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  console.log('Connecting... waiting for open state (may reuse existing session)...');

  let opened = false;
  sock.ev.on('connection.update', update => {
    if (update.connection === 'open') {
      opened = true;
    }
    if (update.connection === 'close') {
      // ignore
    }
  });

  // wait for open (timeout 20s)
  const start = Date.now();
  while (!opened && Date.now() - start < 20000) {
    await new Promise(r => setTimeout(r, 200));
  }

  if (!opened) {
    console.warn('Warning: socket did not reach open state; attempting to send anyway.');
  }

  try {
    const stream = fs.createReadStream(absPath);
    console.log('Sending file to', chatId);
    const res = await sock.sendMessage(chatId, { video: stream, caption: 'Aquí tienes el vídeo (.tiktok)', mimetype: 'video/mp4' });
    console.log('Send result:', res?.key);
  } catch (err) {
    console.error('Error sending file:', err?.message || err);
    process.exit(4);
  } finally {
    // give a moment then close
    await new Promise(r => setTimeout(r, 800));
    try { sock.end(); } catch (e) {}
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
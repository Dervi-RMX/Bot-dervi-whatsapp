const path = require('path');
const { downloadWithYtDlp } = require('./lib/downloader');
(async () => {
  try {
    console.log('Starting test download...');
    const res = await downloadWithYtDlp('https://vt.tiktok.com/ZS4EYKV7v/', path.join(__dirname, 'temp'), { timeout: 180000, cookies: path.join(__dirname, 'temp', 'cookies.txt') });
    console.log('Result:', res);
  } catch (e) {
    console.error('Failed:', e?.toString?.() || e);
    process.exit(1);
  }
})();
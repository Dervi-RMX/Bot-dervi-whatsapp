const { spawnSync } = require('child_process');

try {
  require.resolve('@whiskeysockets/baileys');
  require.resolve('ffmpeg-static');
} catch {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['install', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    shell: false
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const binDirectory = path.join(projectRoot, 'bin');

function getAsset() {
  if (process.platform === 'win32') return { name: 'yt-dlp.exe', mode: 0o755 };
  if (process.platform === 'linux') return { name: 'yt-dlp_linux', mode: 0o755 };
  if (process.platform === 'darwin') return { name: 'yt-dlp_macos', mode: 0o755 };
  throw new Error(`Sistema operativo no compatible para yt-dlp: ${process.platform}`);
}

function download(url, destination, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Demasiadas redirecciones al descargar yt-dlp.'));
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'BOT-SANDBOX/1.0' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        const location = response.headers.location;
        if (!location) return reject(new Error('Redirección sin destino al descargar yt-dlp.'));
        return download(new URL(location, url).toString(), destination, redirects + 1)
          .then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Descarga de yt-dlp falló con HTTP ${response.statusCode}.`));
      }
      const expectedLength = Number(response.headers['content-length'] || 0);
      const temporary = `${destination}.${process.pid}.tmp`;
      const output = fs.createWriteStream(temporary, { mode: 0o755 });
      response.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          try {
            fs.renameSync(temporary, destination);
            fs.chmodSync(destination, 0o755);
            const actualLength = fs.statSync(destination).size;
            if (expectedLength > 0 && actualLength !== expectedLength) {
              throw new Error(`descarga incompleta (${actualLength}/${expectedLength} bytes)`);
            }
            resolve();
          } catch (error) {
            fs.rmSync(temporary, { force: true });
            reject(error);
          }
        });
      });
      output.on('error', error => {
        response.destroy();
        fs.rmSync(temporary, { force: true });
        reject(error);
      });
    }).on('error', reject);
  });
}

function isUsable(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 1024 * 1024) return false;
    execFileSync(filePath, ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const asset = getAsset();
  const destination = path.join(binDirectory, asset.name);
  if (isUsable(destination)) return;
  fs.rmSync(destination, { force: true });
  fs.mkdirSync(binDirectory, { recursive: true });
  console.log(`Descargando yt-dlp para ${process.platform}...`);
  await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset.name}`, destination);
  console.log('yt-dlp listo.');
}

main().catch(error => {
  console.error(`No se pudo preparar yt-dlp: ${error.message}`);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const { ensureDir, safeJoin } = require('./utils');

function createTempCleaner(directory, options = {}) {
  const tempDirectory = path.resolve(directory);
  const maxAgeMs = Math.max(60 * 1000, Number(options.maxAgeMs || 60 * 60 * 1000));
  const activeFiles = new Set();
  let timer = null;

  async function cleanup() {
    ensureDir(tempDirectory);
    const now = Date.now();
    let removed = 0;
    let bytes = 0;
    const names = await fs.promises.readdir(tempDirectory).catch(() => []);
    for (const name of names) {
      let filePath;
      try {
        filePath = safeJoin(tempDirectory, name);
      } catch {
        continue;
      }
      if (activeFiles.has(filePath)) continue;
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile() || now - stat.mtimeMs <= maxAgeMs) continue;
      if (await fs.promises.unlink(filePath).then(() => true).catch(() => false)) {
        removed += 1;
        bytes += stat.size;
      }
    }
    return { removed, bytes };
  }

  return {
    markActive(filePath) {
      activeFiles.add(path.resolve(filePath));
      return filePath;
    },
    release(filePath) {
      activeFiles.delete(path.resolve(filePath));
    },
    cleanup,
    start(intervalMs = 5 * 60 * 1000, logger) {
      if (timer) return;
      cleanup().then(result => {
        if (result.removed) logger?.info?.('TEMP CLEANER', result);
      }).catch(error => logger?.warning?.('Temp cleanup failed', { error: error.message }));
      timer = setInterval(() => {
        cleanup().then(result => {
          if (result.removed) logger?.info?.('TEMP CLEANER', result);
        }).catch(error => logger?.warning?.('Temp cleanup failed', { error: error.message }));
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = { createTempCleaner };

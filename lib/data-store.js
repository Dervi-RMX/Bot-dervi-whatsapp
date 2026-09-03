const fs = require('fs');
const path = require('path');

const rootDirectory = path.resolve(__dirname, '..');

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function getDataPath(dataDirectory, fileName) {
  if (!dataDirectory) throw new Error('dataDirectory is required');
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(fileName)) {
    throw new Error(`Invalid data file name: ${fileName}`);
  }
  return path.join(dataDirectory, fileName);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(filePath, value, options = {}) {
  ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  fs.writeFileSync(temporaryPath, serialized, {
    encoding: 'utf8',
    mode: options.mode || 0o600
  });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporaryPath, filePath);
  }
  try {
    fs.chmodSync(filePath, options.mode || 0o600);
  } catch {
    // Some filesystems do not support chmod.
  }
}

function backupFile(filePath, backupDirectory) {
  if (!fs.existsSync(filePath)) return null;
  ensureDirectory(backupDirectory);
  const destination = path.join(
    backupDirectory,
    `${path.basename(filePath, '.json')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.copyFileSync(filePath, destination);
  return destination;
}

function createDataStore(dataDirectory = path.join(rootDirectory, 'data')) {
  const backupsDirectory = path.join(dataDirectory, 'backups');
  return {
    dataDirectory,
    backupsDirectory,
    path: fileName => getDataPath(dataDirectory, fileName),
    read: (fileName, fallback) => readJson(getDataPath(dataDirectory, fileName), fallback),
    write: (fileName, value, options) => writeJson(getDataPath(dataDirectory, fileName), value, options),
    backup: fileName => backupFile(getDataPath(dataDirectory, fileName), backupsDirectory)
  };
}

module.exports = {
  createDataStore,
  ensureDirectory,
  getDataPath,
  readJson,
  writeJson,
  backupFile
};

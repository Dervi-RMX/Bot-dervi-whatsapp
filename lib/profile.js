const path = require('path');
const { createDataStore } = require('./data-store');
const { normalizeJid } = require('./moderation');

const instances = new Map();

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function createProfileStore(dataDirectory) {
  const store = createDataStore(dataDirectory);
  const profiles = new Map();
  let saveTimer = null;
  let dirty = false;

  try {
    const saved = store.read('users.json', {});
    for (const [key, value] of Object.entries(saved || {})) {
      if (!value || typeof value !== 'object') continue;
      const userId = normalizeJid(value.userId || key);
      if (!userId) continue;
      profiles.set(userId, {
        userId,
        identities: [...new Set([userId, ...(value.identities || [])].map(normalizeJid).filter(Boolean))],
        name: cleanName(value.name) || 'Usuario desconocido',
        pushName: cleanName(value.pushName),
        registrationDate: value.registrationDate || new Date().toISOString(),
        role: cleanName(value.role) || 'Usuario',
        messageCount: Number(value.messageCount) || 0,
        commandCount: Number(value.commandCount) || 0,
        downloadCount: Number(value.downloadCount) || 0,
        lastActivity: value.lastActivity || null
      });
    }
  } catch {
    // A corrupt profile file must not prevent the bot from starting.
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!dirty) return;
      dirty = false;
      try {
        store.write('users.json', Object.fromEntries(profiles));
      } catch (error) {
        dirty = true;
        console.error('Error saving user profiles:', error.message);
      }
    }, 1000);
    saveTimer.unref?.();
  }

  function find(candidates) {
    const normalized = [...new Set((Array.isArray(candidates) ? candidates : [candidates])
      .map(normalizeJid).filter(Boolean))];
    for (const profile of profiles.values()) {
      if (normalized.some(value => profile.identities.includes(value))) return profile;
    }
    return null;
  }

  function ensure(identity, details = {}) {
    const identities = [...new Set((Array.isArray(identity) ? identity : [identity])
      .map(normalizeJid).filter(Boolean))];
    if (!identities.length) return null;
    let profile = find(identities);
    if (!profile) {
      profile = {
        userId: identities[0],
        identities: identities,
        name: cleanName(details.name) || 'Usuario desconocido',
        pushName: cleanName(details.pushName),
        registrationDate: new Date().toISOString(),
        role: cleanName(details.role) || 'Usuario',
        messageCount: 0,
        commandCount: 0,
        downloadCount: 0,
        lastActivity: null
      };
      profiles.set(profile.userId, profile);
    } else {
      profile.identities = [...new Set([...profile.identities, ...identities])];
      if (details.name) profile.name = cleanName(details.name);
      if (details.pushName) profile.pushName = cleanName(details.pushName);
      if (details.role) profile.role = cleanName(details.role);
    }
    scheduleSave();
    return profile;
  }

  return {
    ensure,
    getProfile(identity) {
      return find(identity);
    },
    recordMessage(identity, details = {}) {
      const profile = ensure(identity, details);
      if (!profile) return null;
      profile.messageCount += 1;
      profile.lastActivity = new Date().toISOString();
      scheduleSave();
      return profile;
    },
    recordCommand(identity, details = {}) {
      const profile = ensure(identity, details);
      if (!profile) return null;
      profile.commandCount += 1;
      profile.lastActivity = new Date().toISOString();
      scheduleSave();
      return profile;
    },
    recordDownload(identity, details = {}) {
      const profile = ensure(identity, details);
      if (!profile) return null;
      profile.downloadCount += 1;
      profile.lastActivity = new Date().toISOString();
      scheduleSave();
      return profile;
    },
    flush() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (!dirty) return;
      dirty = false;
      store.write('users.json', Object.fromEntries(profiles));
    }
  };
}

function getProfileStore(dataDirectory = path.join(__dirname, '..', 'data')) {
  const key = path.resolve(dataDirectory);
  if (!instances.has(key)) instances.set(key, createProfileStore(key));
  return instances.get(key);
}

module.exports = { createProfileStore, getProfileStore };

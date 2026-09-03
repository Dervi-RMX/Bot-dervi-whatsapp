const crypto = require('crypto');
const path = require('path');
const { createDataStore } = require('./data-store');

const instances = new Map();

function hashId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createStatsManager(dataDirectory) {
  const store = createDataStore(dataDirectory);
  const fileName = 'stats.json';
  const startedAt = Date.now();
  let state;

  try {
    state = store.read(fileName, null);
  } catch {
    state = null;
  }
  if (!state || typeof state !== 'object') {
    state = {
      startedAt: new Date(startedAt).toISOString(),
      counters: {},
      users: {},
      groups: {}
    };
  }
  state.startedAt = new Date(startedAt).toISOString();
  if (!state.counters || typeof state.counters !== 'object') state.counters = {};
  if (!state.users || typeof state.users !== 'object') state.users = {};
  if (!state.groups || typeof state.groups !== 'object') state.groups = {};

  const save = () => store.write(fileName, state);
  const incrementStat = (name, amount = 1) => {
    const value = Number(state.counters[name] || 0) + Number(amount || 0);
    state.counters[name] = Math.max(0, value);
    save();
    return state.counters[name];
  };
  const incrementEntity = (collection, id, name) => {
    const key = hashId(id);
    if (!key) return false;
    const isNew = !state[collection][key];
    if (!state[collection][key]) state[collection][key] = {};
    state[collection][key][name] = Number(state[collection][key][name] || 0) + 1;
    save();
    return isNew;
  };

  return {
    incrementStat,
    getStats() {
      return {
        ...state.counters,
        startedAt: state.startedAt,
        uptimeMs: Date.now() - startedAt
      };
    },
    resetStats() {
      state.counters = {};
      state.users = {};
      state.groups = {};
      state.startedAt = new Date().toISOString();
      save();
    },
    recordMessage(userId, groupId) {
      incrementStat('messagesProcessed');
      if (userId && incrementEntity('users', userId, 'messages')) incrementStat('activeUsers');
      if (groupId && incrementEntity('groups', groupId, 'messages')) incrementStat('activeGroups');
    },
    recordCommand(userId, groupId) {
      incrementStat('commandsExecuted');
      if (userId) incrementEntity('users', userId, 'commands');
      if (groupId) incrementEntity('groups', groupId, 'commands');
    },
    recordDownload(success) {
      incrementStat('downloads');
      incrementStat(success ? 'downloadsSuccessful' : 'downloadsFailed');
    },
    recordError() {
      incrementStat('botErrors');
    },
    getUserStats(id) {
      return state.users[hashId(id)] || {};
    },
    getGroupStats(id) {
      return state.groups[hashId(id)] || {};
    }
  };
}

function getStatsManager(dataDirectory = path.join(__dirname, '..', 'data')) {
  const key = path.resolve(dataDirectory);
  if (!instances.has(key)) instances.set(key, createStatsManager(key));
  return instances.get(key);
}

module.exports = { createStatsManager, getStatsManager };

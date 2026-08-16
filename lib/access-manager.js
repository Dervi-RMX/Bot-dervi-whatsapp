const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDir } = require('./utils');
const { normalizeJid } = require('./moderation');

const DEFAULT_INVITE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ACCESS_DURATIONS = Object.freeze({
  day: Object.freeze({ key: '1d', label: '1 día', ms: DAY_MS }),
  month: Object.freeze({ key: '1m', label: '1 mes (30 días)', ms: 30 * DAY_MS }),
  year: Object.freeze({ key: '1a', label: '1 año (365 días)', ms: 365 * DAY_MS })
});

const DURATION_ALIASES = new Map([
  ['1d', ACCESS_DURATIONS.day],
  ['d', ACCESS_DURATIONS.day],
  ['dia', ACCESS_DURATIONS.day],
  ['día', ACCESS_DURATIONS.day],
  ['1dia', ACCESS_DURATIONS.day],
  ['1día', ACCESS_DURATIONS.day],
  ['1m', ACCESS_DURATIONS.month],
  ['m', ACCESS_DURATIONS.month],
  ['mes', ACCESS_DURATIONS.month],
  ['1mes', ACCESS_DURATIONS.month],
  ['1a', ACCESS_DURATIONS.year],
  ['a', ACCESS_DURATIONS.year],
  ['ano', ACCESS_DURATIONS.year],
  ['año', ACCESS_DURATIONS.year],
  ['1ano', ACCESS_DURATIONS.year],
  ['1año', ACCESS_DURATIONS.year]
]);

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

function codesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeCode(code) {
  return String(code || '').replace(/\s+/g, '').trim().toUpperCase();
}

function parseAccessDuration(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return DURATION_ALIASES.get(normalized) || null;
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class AccessManager {
  constructor(config) {
    this.config = config;
    this.filePath = path.join(config.dataDirectory, 'access.json');
    this.state = { linkedUsers: {}, invite: null };
    this.loaded = false;
    this.persistenceError = false;
  }

  normalizeLinkedUsers(value) {
    const linkedUsers = {};

    if (Array.isArray(value)) {
      for (const rawJid of value) {
        const jid = normalizeJid(rawJid);
        if (!jid) continue;
        // Legacy entries did not have an expiration; keep them usable until
        // the owner issues a new temporary invitation for that number.
        linkedUsers[jid] = { linkedAt: 0, expiresAt: null };
      }
      return linkedUsers;
    }

    if (!value || typeof value !== 'object') return linkedUsers;

    for (const [rawJid, rawEntry] of Object.entries(value)) {
      const jid = normalizeJid(rawJid);
      if (!jid) continue;
      const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
      const expiresAt = entry.expiresAt === null || entry.expiresAt === undefined
        ? null
        : finiteOr(entry.expiresAt, null);
      linkedUsers[jid] = {
        linkedAt: finiteOr(entry.linkedAt, 0),
        expiresAt
      };
    }

    return linkedUsers;
  }

  normalizeIdentityCandidates(jid, aliases = []) {
    const values = [jid, ...(Array.isArray(aliases) ? aliases : [])];
    return [...new Set(values
      .map(value => normalizeJid(value))
      .filter(value => value && !value.endsWith('@g.us') && !value.endsWith('@broadcast'))
    )];
  }

  load() {
    if (this.loaded) return;
    ensureDir(this.config.dataDirectory);

    if (!fs.existsSync(this.filePath)) {
      this.loaded = true;
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const rawInvite = parsed?.invite && typeof parsed.invite === 'object'
        ? parsed.invite
        : null;
      const accessDurationMs = finiteOr(rawInvite?.accessDurationMs, DAY_MS);

      this.state = {
        linkedUsers: this.normalizeLinkedUsers(parsed?.linkedUsers),
        invite: rawInvite && typeof rawInvite.hash === 'string' && Number.isFinite(Number(rawInvite.expiresAt))
          ? {
              hash: rawInvite.hash,
              createdAt: finiteOr(rawInvite.createdAt, 0),
              expiresAt: Number(rawInvite.expiresAt),
              accessDurationMs: accessDurationMs > 0 ? accessDurationMs : DAY_MS
            }
          : null
      };
    } catch {
      this.state = { linkedUsers: {}, invite: null };
      this.persistenceError = true;
    }

    this.loaded = true;
  }

  writeState(nextState) {
    if (this.persistenceError) throw new Error('Access data unavailable');
    ensureDir(this.config.dataDirectory);
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const serialized = JSON.stringify(nextState, null, 2);
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      // Windows cannot replace an existing file with renameSync.
      if (process.platform !== 'win32') throw error;
      fs.rmSync(this.filePath, { force: true });
      fs.renameSync(tempPath, this.filePath);
    }
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // chmod is not available on every filesystem.
    }
  }

  isLinked(jid, now = Date.now(), aliases = []) {
    this.load();
    const candidates = this.normalizeIdentityCandidates(jid, aliases);
    return candidates.some(candidate => {
      const entry = this.state.linkedUsers[candidate];
      return Boolean(entry) && (entry.expiresAt === null || Number(now) < entry.expiresAt);
    });
  }

  getLink(jid, now = Date.now(), aliases = []) {
    this.load();
    const candidates = this.normalizeIdentityCandidates(jid, aliases);
    for (const candidate of candidates) {
      const entry = this.state.linkedUsers[candidate];
      if (!entry) continue;
      if (entry.expiresAt !== null && Number(now) >= entry.expiresAt) continue;
      return { jid: candidate, ...entry };
    }
    return null;
  }

  getLinkedUsers(now = Date.now()) {
    this.load();
    return Object.keys(this.state.linkedUsers).filter(jid => this.isLinked(jid, now));
  }

  getInviteTtlMs() {
    const configured = Number(this.config.inviteTtlMs);
    if (!Number.isFinite(configured) || configured < 1000) return DEFAULT_INVITE_TTL_MS;
    return configured;
  }

  createInvite(duration, now = Date.now()) {
    this.load();
    const accessDuration = typeof duration === 'string' ? parseAccessDuration(duration) : duration;
    if (!accessDuration || !Number.isFinite(accessDuration.ms) || accessDuration.ms <= 0) {
      throw new Error('Invalid access duration');
    }

    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const createdAt = finiteOr(now, Date.now());
    const expiresAt = createdAt + this.getInviteTtlMs();
    const nextState = {
      ...this.state,
      invite: {
        hash: hashCode(code),
        createdAt,
        expiresAt,
        accessDurationMs: accessDuration.ms
      }
    };

    this.writeState(nextState);
    this.state = nextState;

    return {
      code,
      createdAt,
      expiresAt,
      accessDurationMs: accessDuration.ms,
      accessDurationLabel: accessDuration.label
    };
  }

  consumeInvite(code, jid, now = Date.now(), aliases = []) {
    this.load();
    if (this.persistenceError) return { ok: false, reason: 'unavailable' };
    const normalizedJids = this.normalizeIdentityCandidates(jid, aliases);
    if (!normalizedJids.length) return { ok: false, reason: 'invalid-user' };

    const timestamp = finiteOr(now, Date.now());
    const currentEntry = normalizedJids
      .map(candidate => this.state.linkedUsers[candidate])
      .find(entry => entry && (entry.expiresAt === null || timestamp < entry.expiresAt));
    if (currentEntry) {
      return { ok: true, alreadyLinked: true, expiresAt: currentEntry.expiresAt };
    }

    const invite = this.state.invite;
    if (!invite) return { ok: false, reason: 'not-found' };

    if (timestamp >= invite.expiresAt) {
      const nextState = { ...this.state, invite: null };
      this.writeState(nextState);
      this.state = nextState;
      return { ok: false, reason: 'expired' };
    }

    if (!codesMatch(invite.hash, hashCode(normalizeCode(code)))) {
      return { ok: false, reason: 'invalid' };
    }

    const accessExpiresAt = timestamp + invite.accessDurationMs;
    const linkedEntry = { linkedAt: timestamp, expiresAt: accessExpiresAt };
    const linkedUsers = { ...this.state.linkedUsers };
    for (const candidate of normalizedJids) linkedUsers[candidate] = linkedEntry;

    const nextState = {
      ...this.state,
      linkedUsers,
      invite: null
    };

    this.writeState(nextState);
    this.state = nextState;
    return { ok: true, linked: true, expiresAt: accessExpiresAt };
  }
}

module.exports = {
  AccessManager,
  ACCESS_DURATIONS,
  hashCode,
  normalizeCode,
  parseAccessDuration
};

'use strict';

const DEFAULT_MAX_LEVEL = 5;
const DEFAULT_DECAY_MS = 30_000;

/**
 * Server-owned wanted-state manager.
 *
 * Integrate this with Reldens combat and NPC events. Clients may request an
 * action, but they must never directly set wanted level, offense score, or
 * decay timestamps.
 */
class WantedService {
  constructor(options = {}) {
    this.maxLevel = Number(options.maxLevel || process.env.WANTED_MAX_LEVEL || DEFAULT_MAX_LEVEL);
    this.decayMs = Number(options.decayMs || process.env.WANTED_DECAY_MS || DEFAULT_DECAY_MS);
    this.now = options.now || Date.now;
    this.states = new Map();
  }

  get(playerId) {
    this.#assertPlayerId(playerId);
    const state = this.states.get(playerId) || this.#newState();
    return { ...state };
  }

  recordOffense(playerId, offense = {}) {
    this.#assertPlayerId(playerId);
    const points = this.#offensePoints(offense);
    const previous = this.states.get(playerId) || this.#newState();
    const at = this.now();
    const score = Math.max(0, previous.score + points);
    const next = {
      score,
      level: this.#scoreToLevel(score),
      lastOffenseAt: at,
      nextDecayAt: at + this.decayMs,
      reason: String(offense.type || 'crime')
    };
    this.states.set(playerId, next);
    return { ...next };
  }

  tick(playerId, context = {}) {
    this.#assertPlayerId(playerId);
    const current = this.states.get(playerId);
    if (!current) return this.get(playerId);

    const at = this.now();
    const policeAware = Boolean(context.policeAware);
    const inCombat = Boolean(context.inCombat);
    if (policeAware || inCombat || at < current.nextDecayAt || current.score <= 0) {
      return { ...current };
    }

    const score = Math.max(0, current.score - 1);
    const next = {
      ...current,
      score,
      level: this.#scoreToLevel(score),
      nextDecayAt: at + this.decayMs,
      reason: score === 0 ? null : current.reason
    };
    this.states.set(playerId, next);
    return { ...next };
  }

  clear(playerId) {
    this.#assertPlayerId(playerId);
    this.states.delete(playerId);
    return this.get(playerId);
  }

  shouldPoliceTarget(playerId) {
    return this.get(playerId).level > 0;
  }

  #offensePoints(offense) {
    const type = String(offense.type || '').toLowerCase();
    const table = {
      assault_civilian: 1,
      kill_civilian: 2,
      assault_police: 2,
      kill_police: 3,
      vehicle_theft: 1,
      robbery: 2
    };
    const requested = Number(offense.points);
    if (Number.isFinite(requested)) return Math.max(0, Math.min(5, Math.floor(requested)));
    return table[type] || 1;
  }

  #scoreToLevel(score) {
    if (score <= 0) return 0;
    return Math.min(this.maxLevel, Math.ceil(score / 2));
  }

  #newState() {
    return { score: 0, level: 0, lastOffenseAt: null, nextDecayAt: null, reason: null };
  }

  #assertPlayerId(playerId) {
    if (typeof playerId !== 'string' && typeof playerId !== 'number') {
      throw new TypeError('playerId must be a string or number');
    }
  }
}

module.exports = { WantedService };

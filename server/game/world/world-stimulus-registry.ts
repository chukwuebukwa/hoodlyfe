import type {GameEvent} from '../events/game-events.ts';

export type WorldStimulusKind =
  | 'gunshot'
  | 'impact'
  | 'injury'
  | 'death'
  | 'fire'
  | 'explosion';

export type WorldStimulusEntityKind = 'player' | 'npc' | 'vehicle' | 'effect' | 'world';
export type WorldStimulusChannel = 'hearing' | 'sight' | 'contact';

export interface WorldStimulus {
  id: string;
  kind: WorldStimulusKind;
  sourceId: string;
  sourceKind: WorldStimulusEntityKind;
  subjectId: string;
  subjectKind: WorldStimulusEntityKind;
  actorId: string;
  actorKind: WorldStimulusEntityKind;
  spaceId: string;
  x: number;
  y: number;
  intensity: number;
  radius: number;
  channels: WorldStimulusChannel[];
  provenance: GameEvent['type'];
  occurredAt: number;
  expiresAt: number;
}

export interface RegisterWorldStimulusInput extends Omit<WorldStimulus, 'id' | 'expiresAt'> {
  lifetimeMs: number;
  dedupeKey: string;
  dedupeMs: number;
}

export interface WorldStimulusQuery {
  spaceId: string;
  channels?: readonly WorldStimulusChannel[];
}

interface RecentStimulus {
  id: string;
  occurredAt: number;
}

const KINDS = new Set<WorldStimulusKind>([
  'gunshot', 'impact', 'injury', 'death', 'fire', 'explosion'
]);
const ENTITY_KINDS = new Set<WorldStimulusEntityKind>([
  'player', 'npc', 'vehicle', 'effect', 'world'
]);
const CHANNELS = new Set<WorldStimulusChannel>(['hearing', 'sight', 'contact']);

export class WorldStimulusRegistry {
  private readonly stimuli = new Map<string, WorldStimulus>();
  private readonly recent = new Map<string, RecentStimulus>();
  private nextId = 1;

  constructor(private readonly capacity = 128) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('World stimulus capacity must be a positive integer.');
    }
  }

  get size(): number {
    return this.stimuli.size;
  }

  register(input: RegisterWorldStimulusInput): {stimulus: WorldStimulus; created: boolean} {
    validateInput(input);
    const recent = this.recent.get(input.dedupeKey);
    const existing = recent &&
      input.occurredAt >= recent.occurredAt &&
      input.occurredAt - recent.occurredAt <= input.dedupeMs
      ? this.stimuli.get(recent.id)
      : undefined;
    if (existing && existing.expiresAt > input.occurredAt) {
      Object.assign(existing, stimulusValues(input), {id: existing.id});
      this.recent.set(input.dedupeKey, {id: existing.id, occurredAt: input.occurredAt});
      return {stimulus: cloneStimulus(existing), created: false};
    }

    this.makeRoom();
    const stimulus: WorldStimulus = {
      id: `stimulus-${this.nextId++}`,
      ...stimulusValues(input)
    };
    this.stimuli.set(stimulus.id, stimulus);
    this.recent.set(input.dedupeKey, {id: stimulus.id, occurredAt: input.occurredAt});
    return {stimulus: cloneStimulus(stimulus), created: true};
  }

  nearest(
    x: number,
    y: number,
    nowMs: number,
    query: WorldStimulusQuery
  ): WorldStimulus | undefined {
    validateQuery(x, y, nowMs, query);
    const requestedChannels = query.channels ? new Set(query.channels) : undefined;
    let best: WorldStimulus | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const stimulus of this.stimuli.values()) {
      if (stimulus.expiresAt <= nowMs || stimulus.spaceId !== query.spaceId) continue;
      if (
        requestedChannels &&
        !stimulus.channels.some((channel) => requestedChannels.has(channel))
      ) continue;
      const distance = Math.hypot(stimulus.x - x, stimulus.y - y);
      if (distance > stimulus.radius) continue;
      const score = stimulus.intensity * (1 - distance / stimulus.radius);
      if (
        score > bestScore ||
        (score === bestScore && best && stimulus.occurredAt > best.occurredAt) ||
        (score === bestScore && best && stimulus.occurredAt === best.occurredAt &&
          stimulus.id.localeCompare(best.id) < 0)
      ) {
        best = stimulus;
        bestScore = score;
      }
    }
    return best ? cloneStimulus(best) : undefined;
  }

  expire(nowMs: number): number {
    if (!Number.isFinite(nowMs)) throw new RangeError('World stimulus time must be finite.');
    let removed = 0;
    for (const [id, stimulus] of this.stimuli) {
      if (stimulus.expiresAt > nowMs) continue;
      this.stimuli.delete(id);
      removed += 1;
    }
    for (const [key, recent] of this.recent) {
      if (!this.stimuli.has(recent.id)) this.recent.delete(key);
    }
    return removed;
  }

  snapshot(): WorldStimulus[] {
    return [...this.stimuli.values()].map(cloneStimulus);
  }

  clear(): void {
    this.stimuli.clear();
    this.recent.clear();
    this.nextId = 1;
  }

  private makeRoom(): void {
    if (this.stimuli.size < this.capacity) return;
    const evicted = [...this.stimuli.values()].sort((left, right) => (
      left.expiresAt - right.expiresAt ||
      left.occurredAt - right.occurredAt ||
      left.id.localeCompare(right.id)
    ))[0];
    if (!evicted) return;
    this.stimuli.delete(evicted.id);
    for (const [key, recent] of this.recent) {
      if (recent.id === evicted.id) this.recent.delete(key);
    }
  }
}

function stimulusValues(input: RegisterWorldStimulusInput): Omit<WorldStimulus, 'id'> {
  return {
    kind: input.kind,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    subjectId: input.subjectId,
    subjectKind: input.subjectKind,
    actorId: input.actorId,
    actorKind: input.actorKind,
    spaceId: input.spaceId,
    x: input.x,
    y: input.y,
    intensity: input.intensity,
    radius: input.radius,
    channels: [...input.channels],
    provenance: input.provenance,
    occurredAt: input.occurredAt,
    expiresAt: input.occurredAt + input.lifetimeMs
  };
}

function cloneStimulus(stimulus: WorldStimulus): WorldStimulus {
  return {...stimulus, channels: [...stimulus.channels]};
}

function validateInput(input: RegisterWorldStimulusInput): void {
  if (!KINDS.has(input.kind)) throw new RangeError('Unknown world stimulus kind.');
  if (!ENTITY_KINDS.has(input.sourceKind) || !ENTITY_KINDS.has(input.subjectKind) ||
    !ENTITY_KINDS.has(input.actorKind)) {
    throw new RangeError('Unknown world stimulus entity kind.');
  }
  if (!input.spaceId.trim()) throw new RangeError('World stimulus space is required.');
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    throw new RangeError('World stimulus position must be finite.');
  }
  if (!Number.isFinite(input.intensity) || input.intensity < 0 || input.intensity > 1) {
    throw new RangeError('World stimulus intensity must be between zero and one.');
  }
  if (!Number.isFinite(input.occurredAt)) {
    throw new RangeError('World stimulus occurrence time must be finite.');
  }
  if (!Number.isFinite(input.radius) || input.radius <= 0) {
    throw new RangeError('World stimulus radius must be positive.');
  }
  if (!Number.isFinite(input.lifetimeMs) || input.lifetimeMs <= 0 ||
    !Number.isFinite(input.occurredAt + input.lifetimeMs)) {
    throw new RangeError('World stimulus lifetime must be positive and finite.');
  }
  if (!Number.isFinite(input.dedupeMs) || input.dedupeMs < 0) {
    throw new RangeError('World stimulus dedupe window cannot be negative.');
  }
  if (!input.dedupeKey.trim()) throw new RangeError('World stimulus dedupe key is required.');
  if (input.channels.length === 0 || new Set(input.channels).size !== input.channels.length ||
    input.channels.some((channel) => !CHANNELS.has(channel))) {
    throw new RangeError('World stimulus channels must be unique and recognized.');
  }
}

function validateQuery(x: number, y: number, nowMs: number, query: WorldStimulusQuery): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(nowMs)) {
    throw new RangeError('World stimulus query coordinates and time must be finite.');
  }
  if (!query.spaceId.trim()) throw new RangeError('World stimulus query space is required.');
  if (query.channels?.some((channel) => !CHANNELS.has(channel))) {
    throw new RangeError('World stimulus query channel is not recognized.');
  }
}

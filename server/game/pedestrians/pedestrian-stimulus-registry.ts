export type PedestrianStimulusKind =
  | 'gunshot'
  | 'impact'
  | 'injury'
  | 'death'
  | 'fire'
  | 'explosion';

export interface PedestrianStimulus {
  id: string;
  kind: PedestrianStimulusKind;
  sourceId: string;
  subjectId: string;
  x: number;
  y: number;
  severity: number;
  radius: number;
  occurredAt: number;
  expiresAt: number;
}

export interface RegisterPedestrianStimulusInput {
  kind: PedestrianStimulusKind;
  sourceId?: string;
  subjectId?: string;
  x: number;
  y: number;
  severity: number;
  radius: number;
  occurredAt: number;
  lifetimeMs: number;
  dedupeKey: string;
  dedupeMs: number;
}

interface RecentStimulus {
  id: string;
  occurredAt: number;
}

export class PedestrianStimulusRegistry {
  private readonly stimuli = new Map<string, PedestrianStimulus>();
  private readonly recent = new Map<string, RecentStimulus>();
  private nextId = 1;

  constructor(private readonly capacity = 128) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('Pedestrian stimulus capacity must be a positive integer.');
    }
  }

  get size(): number {
    return this.stimuli.size;
  }

  register(input: RegisterPedestrianStimulusInput): {stimulus: PedestrianStimulus; created: boolean} {
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
      return {stimulus: {...existing}, created: false};
    }

    this.makeRoom();
    const stimulus: PedestrianStimulus = {
      id: `stimulus-${this.nextId++}`,
      ...stimulusValues(input)
    };
    this.stimuli.set(stimulus.id, stimulus);
    this.recent.set(input.dedupeKey, {id: stimulus.id, occurredAt: input.occurredAt});
    return {stimulus: {...stimulus}, created: true};
  }

  nearest(x: number, y: number, nowMs: number): PedestrianStimulus | undefined {
    let best: PedestrianStimulus | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const stimulus of this.stimuli.values()) {
      if (stimulus.expiresAt <= nowMs) continue;
      const distance = Math.hypot(stimulus.x - x, stimulus.y - y);
      if (distance > stimulus.radius) continue;
      const score = stimulus.severity * (1 - distance / stimulus.radius);
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
    return best ? {...best} : undefined;
  }

  expire(nowMs: number): number {
    let removed = 0;
    for (const [id, stimulus] of this.stimuli) {
      if (stimulus.expiresAt > nowMs) continue;
      this.stimuli.delete(id);
      removed++;
    }
    for (const [key, recent] of this.recent) {
      if (!this.stimuli.has(recent.id)) this.recent.delete(key);
    }
    return removed;
  }

  snapshot(): PedestrianStimulus[] {
    return [...this.stimuli.values()].map((stimulus) => ({...stimulus}));
  }

  private makeRoom(): void {
    if (this.stimuli.size < this.capacity) return;
    const oldest = [...this.stimuli.values()].sort((left, right) => (
      left.expiresAt - right.expiresAt ||
      left.occurredAt - right.occurredAt ||
      left.id.localeCompare(right.id)
    ))[0];
    if (!oldest) return;
    this.stimuli.delete(oldest.id);
    for (const [key, recent] of this.recent) {
      if (recent.id === oldest.id) this.recent.delete(key);
    }
  }
}

function stimulusValues(input: RegisterPedestrianStimulusInput): Omit<PedestrianStimulus, 'id'> {
  return {
    kind: input.kind,
    sourceId: input.sourceId ?? '',
    subjectId: input.subjectId ?? '',
    x: input.x,
    y: input.y,
    severity: clamp(input.severity, 0, 1),
    radius: input.radius,
    occurredAt: input.occurredAt,
    expiresAt: input.occurredAt + input.lifetimeMs
  };
}

function validateInput(input: RegisterPedestrianStimulusInput): void {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    throw new RangeError('Pedestrian stimulus position must be finite.');
  }
  if (!Number.isFinite(input.severity)) {
    throw new RangeError('Pedestrian stimulus severity must be finite.');
  }
  if (!Number.isFinite(input.occurredAt)) {
    throw new RangeError('Pedestrian stimulus occurrence time must be finite.');
  }
  if (!Number.isFinite(input.radius) || input.radius <= 0) {
    throw new RangeError('Pedestrian stimulus radius must be positive.');
  }
  if (!Number.isFinite(input.lifetimeMs) || input.lifetimeMs <= 0) {
    throw new RangeError('Pedestrian stimulus lifetime must be positive.');
  }
  if (!Number.isFinite(input.dedupeMs) || input.dedupeMs < 0) {
    throw new RangeError('Pedestrian stimulus dedupe window cannot be negative.');
  }
  if (!input.dedupeKey) {
    throw new RangeError('Pedestrian stimulus dedupe key is required.');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

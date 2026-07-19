import type {GameEvent} from '../events/game-events.ts';
import type {JournalSink} from './journal-sink.ts';
import {JOURNAL_FORMAT_VERSION, type JournalHeader, type JournalRecord} from './journal-types.ts';

export const DEFAULT_HASH_INTERVAL_TICKS = 30;

export interface SimulationJournalOptions {
  sink: JournalSink;
  seed: string | number;
  epochMs: number;
  stepMs: number;
  collisionRevision: number;
  rolloutRevision: string;
  hashState: () => number;
  hashIntervalTicks?: number;
  onFailure?: (error: unknown) => void;
}

// Recording failure must never block or mutate the authoritative simulation: the
// journal disables itself on the first sink error instead of throwing into a phase.
export class SimulationJournal {
  readonly hashIntervalTicks: number;
  private failed = false;

  constructor(private readonly options: SimulationJournalOptions) {
    this.hashIntervalTicks = positiveInteger(
      options.hashIntervalTicks ?? DEFAULT_HASH_INTERVAL_TICKS,
      'Journal hash interval'
    );
    this.guard(() => this.options.sink.begin(this.header()));
  }

  recordSpawn(tick: number, sessionId: string, options: {name?: string; appearance?: unknown}): void {
    this.append({kind: 'spawn', tick, sessionId, name: options.name, appearance: options.appearance});
  }

  recordLeave(tick: number, sessionId: string): void {
    this.append({kind: 'leave', tick, sessionId});
  }

  recordCommand(tick: number, sessionId: string, type: string, payload: unknown): void {
    this.append({kind: 'command', tick, sessionId, type, payload});
  }

  observeTick(tick: number, events: readonly GameEvent[]): void {
    if (events.length > 0) this.append({kind: 'events', tick, events: [...events]});
    if (tick > 0 && tick % this.hashIntervalTicks === 0) {
      this.guard(() => {
        const value = this.options.hashState();
        this.options.sink.append({kind: 'hash', tick, value});
      });
    }
  }

  close(): void {
    this.guard(() => this.options.sink.close());
  }

  private header(): JournalHeader {
    return {
      kind: 'header',
      version: JOURNAL_FORMAT_VERSION,
      seed: this.options.seed,
      epochMs: this.options.epochMs,
      stepMs: this.options.stepMs,
      hashIntervalTicks: this.hashIntervalTicks,
      collisionRevision: this.options.collisionRevision,
      rolloutRevision: this.options.rolloutRevision,
      recordedAt: new Date(this.options.epochMs).toISOString()
    };
  }

  private append(record: JournalRecord): void {
    this.guard(() => this.options.sink.append(record));
  }

  private guard(write: () => void): void {
    if (this.failed) return;
    try {
      write();
    } catch (error) {
      this.failed = true;
      this.options.onFailure?.(error);
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

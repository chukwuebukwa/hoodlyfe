import type {GameEvent} from '../events/game-events.ts';

export const JOURNAL_FORMAT_VERSION = 1;

export interface JournalHeader {
  kind: 'header';
  version: typeof JOURNAL_FORMAT_VERSION;
  seed: string | number;
  epochMs: number;
  stepMs: number;
  hashIntervalTicks: number;
  collisionRevision: number;
  rolloutRevision: string;
  recordedAt: string;
}

export interface JournalSpawnRecord {
  kind: 'spawn';
  tick: number;
  sessionId: string;
  name?: string;
  appearance?: unknown;
}

export interface JournalLeaveRecord {
  kind: 'leave';
  tick: number;
  sessionId: string;
}

export interface JournalCommandRecord {
  kind: 'command';
  tick: number;
  sessionId: string;
  type: string;
  payload: unknown;
}

export interface JournalEventsRecord {
  kind: 'events';
  tick: number;
  events: GameEvent[];
}

export interface JournalHashRecord {
  kind: 'hash';
  tick: number;
  value: number;
}

export type JournalRecord =
  | JournalSpawnRecord
  | JournalLeaveRecord
  | JournalCommandRecord
  | JournalEventsRecord
  | JournalHashRecord;

export interface RecordedJournal {
  header: JournalHeader;
  records: JournalRecord[];
}

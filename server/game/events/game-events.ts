import type {CrimeKind} from '../incidents/crime-policy.ts';

export type DamageTargetKind = 'player' | 'npc';

interface EventMetadata {
  tick: number;
  nowMs: number;
}

export interface DamageAppliedEvent extends EventMetadata {
  type: 'damage.applied';
  targetId: string;
  targetKind: DamageTargetKind;
  attackerId: string;
  amount: number;
  remainingHealth: number;
}

export interface EntityKilledEvent extends EventMetadata {
  type: 'entity.killed';
  entityId: string;
  entityKind: DamageTargetKind;
  attackerId: string;
}

export interface CrimeCommittedEvent extends EventMetadata {
  type: 'crime.committed';
  incidentId: string;
  suspectId: string;
  victimId: string;
  crimeKind: CrimeKind;
  severity: number;
  x: number;
  y: number;
}

export interface IncidentReportedEvent extends EventMetadata {
  type: 'incident.reported';
  incidentId: string;
  suspectId: string;
  witnessId: string;
  wantedLevel: number;
}

export interface PursuitChangedEvent extends EventMetadata {
  type: 'pursuit.changed';
  officerId: string;
  previousSuspectId: string;
  suspectId: string;
}

export interface PlayerRespawnedEvent extends EventMetadata {
  type: 'player.respawned';
  playerId: string;
  x: number;
  y: number;
}

export type GameEvent =
  | DamageAppliedEvent
  | EntityKilledEvent
  | CrimeCommittedEvent
  | IncidentReportedEvent
  | PursuitChangedEvent
  | PlayerRespawnedEvent;

export class GameEventStream {
  private readonly pending: GameEvent[] = [];

  constructor(private readonly capacity = 2048) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('Game event capacity must be a positive integer.');
    }
  }

  get size(): number {
    return this.pending.length;
  }

  publish(event: GameEvent): void {
    if (this.pending.length >= this.capacity) {
      throw new Error(`Game event capacity exceeded: ${this.capacity}.`);
    }
    this.pending.push(event);
  }

  drain(): GameEvent[] {
    return this.pending.splice(0, this.pending.length);
  }

  clear(): void {
    this.pending.length = 0;
  }
}

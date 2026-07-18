import type {CrimeKind} from '../incidents/crime-policy.ts';

export type DamageTargetKind = 'player' | 'npc';

interface EventMetadata {
  tick: number;
  nowMs: number;
}

export interface WeaponFiredEvent extends EventMetadata {
  type: 'weapon.fired';
  ownerId: string;
  ownerKind: 'player' | 'police' | 'hostile';
  weapon: string;
  x: number;
  y: number;
}

export interface MeleeAttackStartedEvent extends EventMetadata {
  type: 'melee.started';
  playerId: string;
  weapon: string;
  combo: number;
  x: number;
  y: number;
}

export interface NpcMeleeAttackStartedEvent extends EventMetadata {
  type: 'npc.melee.started';
  npcId: string;
  targetId: string;
  x: number;
  y: number;
}

export interface ExplosionCreatedEvent extends EventMetadata {
  type: 'explosion.created';
  explosionId: string;
  kind: 'grenade' | 'rocket' | 'vehicle';
  sourceId: string;
  sourceKind: 'player' | 'vehicle' | 'world';
  x: number;
  y: number;
  radius: number;
}

export interface FireCreatedEvent extends EventMetadata {
  type: 'fire.created';
  fireId: string;
  sourceId: string;
  x: number;
  y: number;
  radius: number;
  expiresAt: number;
}

export interface WeaponPickupCollectedEvent extends EventMetadata {
  type: 'pickup.collected';
  pickupId: string;
  playerId: string;
  weapon: string;
  quantity: number;
}

export interface CashPickupCollectedEvent extends EventMetadata {
  type: 'cash-pickup.collected';
  pickupId: string;
  playerId: string;
  amount: number;
}

export interface DamageAppliedEvent extends EventMetadata {
  type: 'damage.applied';
  targetId: string;
  targetKind: DamageTargetKind;
  attackerId: string;
  amount: number;
  armorDamage: number;
  healthDamage: number;
  remainingArmor: number;
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

export type VehicleDamageSource = 'world' | 'vehicle' | 'weapon' | 'explosion';

export interface VehicleDamagedEvent extends EventMetadata {
  type: 'vehicle.damaged';
  vehicleId: string;
  sourceId: string;
  sourceKind: VehicleDamageSource;
  amount: number;
  remainingHealth: number;
}

export interface VehicleDestroyedEvent extends EventMetadata {
  type: 'vehicle.destroyed';
  vehicleId: string;
  sourceId: string;
  sourceKind: VehicleDamageSource;
  occupantIds: string[];
}

export interface VehicleIgnitedEvent extends EventMetadata {
  type: 'vehicle.ignited';
  vehicleId: string;
  sourceId: string;
  sourceKind: VehicleDamageSource;
  explodesAt: number;
}

export interface VehicleRestoredEvent extends EventMetadata {
  type: 'vehicle.restored';
  vehicleId: string;
  health: number;
}

export interface PlayerRespawnedEvent extends EventMetadata {
  type: 'player.respawned';
  playerId: string;
  x: number;
  y: number;
}

export interface PoliceArrestStartedEvent extends EventMetadata {
  type: 'police.arrest-started';
  arrestId: string;
  officerId: string;
  suspectId: string;
  wantedLevel: number;
}

export interface PoliceArrestCancelledEvent extends EventMetadata {
  type: 'police.arrest-cancelled';
  arrestId: string;
  officerId: string;
  suspectId: string;
  reason: string;
}

export interface PlayerBustedEvent extends EventMetadata {
  type: 'player.busted';
  arrestId: string;
  officerId: string;
  playerId: string;
  wantedLevel: number;
  fine: number;
  x: number;
  y: number;
}

export interface MissionPhaseChangedEvent extends EventMetadata {
  type: 'mission.phase-changed';
  missionId: string;
  leaderId: string;
  previousPhase: string;
  phase: string;
}

export interface MissionPayoutEvent extends EventMetadata {
  type: 'mission.payout';
  missionId: string;
  playerId: string;
  amount: number;
  idempotencyKey: string;
}

export interface MissionFailedEvent extends EventMetadata {
  type: 'mission.failed';
  missionId: string;
  leaderId: string;
  reason: string;
}

export interface StreetEconomyChangedEvent extends EventMetadata {
  type: 'economy.changed';
  transactionId: string;
  playerId: string;
  direction: 'credit' | 'debit';
  reason: string;
  requestedAmount: number;
  amount: number;
  balance: number;
}

export type GameEvent =
  | WeaponFiredEvent
  | MeleeAttackStartedEvent
  | NpcMeleeAttackStartedEvent
  | ExplosionCreatedEvent
  | FireCreatedEvent
  | WeaponPickupCollectedEvent
  | CashPickupCollectedEvent
  | DamageAppliedEvent
  | EntityKilledEvent
  | CrimeCommittedEvent
  | IncidentReportedEvent
  | PursuitChangedEvent
  | VehicleDamagedEvent
  | VehicleIgnitedEvent
  | VehicleDestroyedEvent
  | VehicleRestoredEvent
  | PlayerRespawnedEvent
  | PoliceArrestStartedEvent
  | PoliceArrestCancelledEvent
  | PlayerBustedEvent
  | MissionPhaseChangedEvent
  | MissionPayoutEvent
  | MissionFailedEvent
  | StreetEconomyChangedEvent;

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

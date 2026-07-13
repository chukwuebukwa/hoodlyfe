import type {VehicleKind} from '../content/vehicle-catalog.ts';

export const PLAYER_INPUT_COMMAND_MESSAGE = 'simulation.input';
export const APPLIED_INPUT_RECEIPT_MESSAGE = 'simulation.input.applied';
export const INTERACTION_SNAPSHOT_MESSAGE = 'simulation.snapshot';
export const INTERACTION_PROTOCOL_VERSION = 3;
export const MAX_INPUT_SEQUENCE_ADVANCE = 4_096;
export const MAX_PREDICTED_SPAWN_IDS = 8;
export const MAX_INTERACTION_ENTITIES = 64;
export const DEFAULT_INTERACTION_HISTORY_TICKS = 24;

export const PLAYER_INPUT_BUTTON = Object.freeze({
  fire: 1 << 0,
  melee: 1 << 1,
  use: 1 << 2,
  enter: 1 << 3,
  sprint: 1 << 4,
  reload: 1 << 5
});

export interface PlayerInputCommand {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly clientTick: number;
  readonly clientSampleTimeMs: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly aimAngle: number;
  readonly buttons: number;
  readonly selectedWeaponSlot: number;
  readonly controlledEntityId: string;
  readonly predictedSpawnIds: readonly number[];
}

export interface AppliedInputReceipt {
  readonly playerId: string;
  readonly controlledEntityId: string;
  readonly serverTick: number;
  readonly appliedSequence: number;
  readonly rejectedButtons: number;
  readonly lateByTicks: number;
}

export interface PlayerInputValidationContext {
  readonly previousSequence: number;
  readonly minimumClientTick: number;
  readonly maximumClientTick: number;
  readonly expectedControlledEntityId?: string;
  readonly maximumSequenceAdvance?: number;
}

export interface KinematicInteractionState {
  readonly id: string;
  readonly kind: 'player' | 'pedestrian' | 'vehicle' | 'prop' | 'projectile';
  readonly spaceId: string;
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly angularVelocity: number;
  readonly colliderRevision: number;
  readonly lifecycleRevision: number;
  readonly interactionPriority: InteractionPhysicalPriority;
}

export type InteractionPhysicalPriority = 'player-controlled' | 'mission-critical' | 'ambient';
export type InteractionControlMode = 'on-foot' | 'driver' | 'passenger';

export interface HumanoidInteractionState extends KinematicInteractionState {
  readonly kind: 'player' | 'pedestrian';
  readonly radius: number;
  readonly movementMode: 'idle' | 'walk' | 'run' | 'sprint' | 'aim';
  readonly actionPhase: 'free' | 'melee' | 'reload' | 'hit' | 'knockdown' | 'entering';
  readonly actionTick: number;
  readonly surfaceId: string;
  readonly alive: boolean;
}

export interface VehicleInteractionState extends KinematicInteractionState {
  readonly kind: 'vehicle';
  readonly vehicleKind: VehicleKind;
  readonly speed: number;
  readonly steering: number;
  readonly engineDamage: number;
  readonly onFire: boolean;
  readonly destroyed: boolean;
}

export interface PropInteractionState extends KinematicInteractionState {
  readonly kind: 'prop';
  readonly radius: number;
  readonly mass: number;
}

export interface ProjectileInteractionState extends KinematicInteractionState {
  readonly kind: 'projectile';
  readonly radius: number;
  readonly ownerId: string;
}

export type InteractionEntityState =
  | HumanoidInteractionState
  | VehicleInteractionState
  | PropInteractionState
  | ProjectileInteractionState;

export interface RemoteIntentState {
  readonly entityId: string;
  readonly appliedAtServerTick: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly steering: number;
  readonly throttle: number;
}

export interface InteractionSnapshot {
  readonly protocolVersion: number;
  readonly serverTick: number;
  readonly serverTimeMs: number;
  readonly worldCollisionRevision: number;
  readonly controlRevision: number;
  readonly controlMode: InteractionControlMode;
  readonly acknowledgedLocalInputSequence: number;
  readonly entities: readonly InteractionEntityState[];
  readonly remoteIntents: readonly RemoteIntentState[];
  readonly confirmedEventsThrough: number;
}

export interface InteractionSnapshotValidationContext {
  readonly currentServerTick: number;
  readonly expectedWorldCollisionRevision: number;
  readonly maximumHistoryTicks?: number;
  readonly maximumFutureTicks?: number;
  readonly maximumEntities?: number;
}

export type InteractionProtocolRejection =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'invalid-sequence'
  | 'stale-sequence'
  | 'sequence-window-exceeded'
  | 'invalid-client-tick'
  | 'stale-client-tick'
  | 'future-client-tick'
  | 'invalid-number'
  | 'invalid-buttons'
  | 'invalid-controlled-entity'
  | 'invalid-predicted-spawn-id'
  | 'invalid-server-tick'
  | 'stale-snapshot'
  | 'future-snapshot'
  | 'collision-revision-mismatch'
  | 'invalid-control-state'
  | 'capacity-exceeded'
  | 'invalid-entity'
  | 'duplicate-entity'
  | 'invalid-intent'
  | 'duplicate-intent'
  | 'missing-intent-entity'
  | 'mixed-space-baseline';

export type InteractionValidationResult<T> =
  | {readonly accepted: true; readonly value: T}
  | {readonly accepted: false; readonly reason: InteractionProtocolRejection};

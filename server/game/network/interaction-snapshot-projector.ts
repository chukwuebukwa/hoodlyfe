import {GRENADE_PROJECTILE, ROCKET_PROJECTILE} from '../../../shared/content/explosives.ts';
import {MOLOTOV_PROJECTILE} from '../../../shared/content/fire-zones.ts';
import {isVehicleKind, vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  INTERACTION_PROTOCOL_VERSION,
  MAX_INTERACTION_ENTITIES,
  type HumanoidInteractionState,
  type InteractionEntityState,
  type InteractionControlMode,
  type InteractionPhysicalPriority,
  type InteractionSnapshot,
  type KinematicInteractionState,
  type RemoteIntentState
} from '../../../shared/protocol/interaction-contracts.ts';
import {validateInteractionSnapshot} from '../../../shared/protocol/interaction-snapshot-validation.ts';
import {
  ON_FOOT_PLAYER_RADIUS,
  ON_FOOT_PLAYER_SPEED,
  onFootMovementScale
} from '../../../shared/simulation/on-foot-step.ts';
import type {
  DistrictState,
  NpcState,
  PlayerState,
  VehicleState
} from '../../state.ts';
import {PEDESTRIAN_RADIUS} from '../pedestrians/pedestrian-config.ts';
import {rankInteractionBaselineCandidates} from './interaction-baseline-admission.ts';

export interface InteractionCandidateReference {
  kind: InteractionEntityState['kind'];
  id: string;
}

export interface InteractionProjectionAnchor extends InteractionCandidateReference {
  x: number;
  y: number;
  spaceId: string;
  layerId: string;
}

export interface InteractionAppliedIntent {
  inputX: number;
  inputY: number;
  sequence: number;
}

export interface InteractionProjectileMotion {
  velocityX: number;
  velocityY: number;
}

interface InteractionClock {
  tick: number;
  nowMs: number;
}

export interface InteractionSnapshotProjectorOptions {
  state: DistrictState;
  clock: () => InteractionClock;
  worldCollisionRevision: number;
  playerIntentFor?: (playerId: string) => InteractionAppliedIntent | undefined;
  vehicleIntentFor?: (
    playerId: string,
    vehicleId: string
  ) => InteractionAppliedIntent | undefined;
  projectileMotionFor?: (projectileId: string) => InteractionProjectileMotion | undefined;
  priorityFor?: (
    kind: InteractionEntityState['kind'],
    id: string
  ) => InteractionPhysicalPriority | undefined;
  candidatesFor?: (
    playerId: string,
    anchor: InteractionProjectionAnchor
  ) => readonly InteractionCandidateReference[];
  publish?: (playerId: string, snapshot: InteractionSnapshot) => void;
  historyTicks?: number;
  maximumEntities?: number;
}

interface EntityTrack {
  object: object;
  lifecycleActive: boolean;
  lifecycleRevision: number;
  colliderSignature: string;
  colliderRevision: number;
  lastSeenTick: number;
  lastTimeMs: number;
  x: number;
  y: number;
  angle: number;
  actionPhase: HumanoidInteractionState['actionPhase'];
  actionPhaseStartedAtTick: number;
}

interface CapturedFrame {
  tick: number;
  timeMs: number;
  confirmedEventsThrough: number;
  entities: ReadonlyMap<string, InteractionEntityState>;
  intents: ReadonlyMap<string, RemoteIntentState>;
  roots: ReadonlyMap<string, string>;
  controlModes: ReadonlyMap<string, InteractionControlMode>;
  controlRevisions: ReadonlyMap<string, number>;
  acknowledgedSequences: ReadonlyMap<string, number>;
}

interface ControlTrack {
  signature: string;
  revision: number;
  lastSeenTick: number;
}

export class InteractionSnapshotProjector {
  private readonly tracks = new Map<string, EntityTrack>();
  private readonly controlTracks = new Map<string, ControlTrack>();
  private readonly histories = new Map<string, InteractionSnapshot[]>();
  private readonly historyTicks: number;
  private readonly maximumEntities: number;
  private frame?: CapturedFrame;

  constructor(private readonly options: InteractionSnapshotProjectorOptions) {
    this.historyTicks = positiveInteger(
      options.historyTicks ?? DEFAULT_INTERACTION_HISTORY_TICKS,
      'Interaction history ticks'
    );
    this.maximumEntities = positiveInteger(
      options.maximumEntities ?? MAX_INTERACTION_ENTITIES,
      'Maximum interaction entities'
    );
    if (this.maximumEntities > MAX_INTERACTION_ENTITIES) {
      throw new RangeError(`Maximum interaction entities cannot exceed ${MAX_INTERACTION_ENTITIES}.`);
    }
    if (!Number.isSafeInteger(options.worldCollisionRevision) || options.worldCollisionRevision <= 0) {
      throw new RangeError('World collision revision must be a positive safe integer.');
    }
  }

  capture(confirmedEventsThrough?: number): boolean {
    const clock = this.options.clock();
    if (
      !Number.isSafeInteger(clock.tick) || clock.tick < 0 ||
      !Number.isFinite(clock.nowMs) || clock.nowMs < 0 ||
      (this.frame && clock.tick <= this.frame.tick)
    ) return false;
    const entities = new Map<string, InteractionEntityState>();
    const intents = new Map<string, RemoteIntentState>();
    const roots = new Map<string, string>();
    const controlModes = new Map<string, InteractionControlMode>();
    const controlRevisions = new Map<string, number>();
    const acknowledgedSequences = new Map<string, number>();

    for (const player of this.options.state.players.values()) {
      const vehicle = player.vehicleId
        ? this.options.state.vehicles.get(player.vehicleId)
        : undefined;
      const rootKey = entityKey(vehicle ? 'vehicle' : 'player', vehicle?.id ?? player.id);
      const controlMode: InteractionControlMode = !vehicle
        ? 'on-foot'
        : player.vehicleSeat === 0
          ? 'driver'
          : 'passenger';
      const controlSignature = `${rootKey}:${controlMode}:${player.vehicleSeat}`;
      const previousControl = this.controlTracks.get(player.id);
      const controlChanged = Boolean(previousControl && (
        previousControl.signature !== controlSignature ||
        previousControl.lastSeenTick < clock.tick - 1
      ));
      const controlRevision = previousControl
        ? previousControl.revision + (controlChanged ? 1 : 0)
        : 1;
      this.controlTracks.set(player.id, {
        signature: controlSignature,
        revision: controlRevision,
        lastSeenTick: clock.tick
      });
      roots.set(player.id, rootKey);
      controlModes.set(player.id, controlMode);
      controlRevisions.set(player.id, controlRevision);
      acknowledgedSequences.set(
        player.id,
        vehicle && player.vehicleSeat === 0
          ? nonnegativeInteger(player.lastVehicleInputSequence)
          : nonnegativeInteger(player.lastInputSequence)
      );
      if (vehicle) continue;
      const intent = this.options.playerIntentFor?.(player.id);
      const projected = this.projectPlayer(player, clock, intent);
      if (!projected) continue;
      entities.set(entityKey(projected.kind, projected.id), projected);
      if (intent) {
        intents.set(entityKey(projected.kind, projected.id), appliedIntent(
          projected.id,
          clock.tick,
          intent.inputX,
          intent.inputY,
          0,
          0,
          onFootMovementScale(player.action, player.weapon, player.attackCombo)
        ));
      }
    }
    for (const npc of this.options.state.npcs.values()) {
      const projected = this.projectNpc(npc, clock);
      if (!projected) continue;
      const key = entityKey(projected.kind, projected.id);
      entities.set(key, projected);
      const speed = Math.hypot(projected.velocityX, projected.velocityY);
      if (speed > 0.001) {
        intents.set(key, appliedIntent(
          projected.id,
          clock.tick,
          projected.velocityX / speed,
          projected.velocityY / speed,
          0,
          0,
          Math.min(2, speed / ON_FOOT_PLAYER_SPEED)
        ));
      }
    }
    for (const vehicle of this.options.state.vehicles.values()) {
      const driver = vehicle.driverId ? this.options.state.players.get(vehicle.driverId) : undefined;
      const intent = driver
        ? this.options.vehicleIntentFor?.(driver.id, vehicle.id)
        : undefined;
      const projected = this.projectVehicle(vehicle, clock, intent);
      if (!projected) continue;
      entities.set(entityKey(projected.kind, projected.id), projected);
      if (intent) {
        intents.set(entityKey(projected.kind, projected.id), appliedIntent(
          projected.id,
          clock.tick,
          0,
          0,
          intent.inputX,
          -intent.inputY,
          1
        ));
      }
    }
    for (const rocket of this.options.state.rockets.values()) {
      const projected = this.projectProjectile(
        rocket,
        ROCKET_PROJECTILE.radius,
        rocket.ownerId,
        clock,
        this.options.projectileMotionFor?.(rocket.id)
      );
      if (projected) entities.set(entityKey(projected.kind, projected.id), projected);
    }
    for (const projectile of this.options.state.thrownProjectiles.values()) {
      const radius = projectile.kind === 'molotov'
        ? MOLOTOV_PROJECTILE.radius
        : GRENADE_PROJECTILE.radius;
      const projected = this.projectProjectile(
        projectile,
        radius,
        projectile.ownerId,
        clock,
        this.options.projectileMotionFor?.(projectile.id)
      );
      if (projected) entities.set(entityKey(projected.kind, projected.id), projected);
    }
    this.pruneTracks(clock.tick);

    const confirmed = nonnegativeInteger(confirmedEventsThrough ?? clock.tick);
    this.frame = {
      tick: clock.tick,
      timeMs: clock.nowMs,
      confirmedEventsThrough: Math.min(clock.tick, confirmed),
      entities,
      intents,
      roots,
      controlModes,
      controlRevisions,
      acknowledgedSequences
    };
    return true;
  }

  publishCurrent(playerIds: Iterable<string>): number {
    if (!this.options.candidatesFor || !this.options.publish) return 0;
    let published = 0;
    for (const playerId of playerIds) {
      const anchor = this.anchorFor(playerId);
      if (!anchor) continue;
      const snapshot = this.project(playerId, this.options.candidatesFor(playerId, anchor));
      if (!snapshot) continue;
      this.options.publish(playerId, snapshot);
      published++;
    }
    return published;
  }

  project(
    playerId: string,
    candidates: readonly InteractionCandidateReference[] = []
  ): InteractionSnapshot | undefined {
    const frame = this.frame;
    const rootKey = frame?.roots.get(playerId);
    const root = rootKey ? frame?.entities.get(rootKey) : undefined;
    if (!frame || !root || !rootKey) return undefined;
    const entities: InteractionEntityState[] = [root];
    const selectedKeys = new Set([rootKey]);
    const selectedIds = new Set([root.id]);
    const candidateEntities: InteractionEntityState[] = [];
    for (const candidate of candidates) {
      const key = entityKey(candidate.kind, candidate.id);
      if (selectedKeys.has(key) || selectedIds.has(candidate.id)) continue;
      const entity = frame.entities.get(key);
      if (!entity || entity.spaceId !== root.spaceId || entity.layerId !== root.layerId) continue;
      selectedKeys.add(key);
      selectedIds.add(entity.id);
      candidateEntities.push(entity);
    }
    selectedKeys.clear();
    selectedKeys.add(rootKey);
    for (const entity of rankInteractionBaselineCandidates(root, candidateEntities)) {
      if (entities.length >= this.maximumEntities) break;
      const key = entityKey(entity.kind, entity.id);
      selectedKeys.add(key);
      entities.push(entity);
    }
    const remoteIntents = [...selectedKeys]
      .filter((key) => key !== rootKey)
      .map((key) => frame.intents.get(key))
      .filter((intent): intent is RemoteIntentState => Boolean(intent));
    const result = validateInteractionSnapshot({
      protocolVersion: INTERACTION_PROTOCOL_VERSION,
      serverTick: frame.tick,
      serverTimeMs: frame.timeMs,
      worldCollisionRevision: this.options.worldCollisionRevision,
      controlRevision: frame.controlRevisions.get(playerId) ?? 1,
      controlMode: frame.controlModes.get(playerId) ?? 'on-foot',
      acknowledgedLocalInputSequence: frame.acknowledgedSequences.get(playerId) ?? 0,
      entities,
      remoteIntents,
      confirmedEventsThrough: frame.confirmedEventsThrough
    }, {
      currentServerTick: frame.tick,
      expectedWorldCollisionRevision: this.options.worldCollisionRevision,
      maximumHistoryTicks: this.historyTicks,
      maximumEntities: this.maximumEntities
    });
    if (!result.accepted) return undefined;
    this.pin(playerId, result.value);
    return result.value;
  }

  anchorFor(playerId: string): InteractionProjectionAnchor | undefined {
    const frame = this.frame;
    const rootKey = frame?.roots.get(playerId);
    const root = rootKey ? frame?.entities.get(rootKey) : undefined;
    return root ? {
      kind: root.kind,
      id: root.id,
      x: root.x,
      y: root.y,
      spaceId: root.spaceId,
      layerId: root.layerId
    } : undefined;
  }

  snapshotAt(playerId: string, serverTick: number): InteractionSnapshot | undefined {
    return this.histories.get(playerId)?.find((snapshot) => snapshot.serverTick === serverTick);
  }

  historyFor(playerId: string): readonly InteractionSnapshot[] {
    return Object.freeze([...(this.histories.get(playerId) ?? [])]);
  }

  clearPlayer(playerId: string): void {
    this.histories.delete(playerId);
    this.controlTracks.delete(playerId);
  }

  private projectPlayer(
    player: PlayerState,
    clock: InteractionClock,
    intent?: InteractionAppliedIntent
  ): HumanoidInteractionState | undefined {
    const phase = humanoidActionPhase(player.action, player.reactionKind);
    const common = this.commonState(
      'player',
      player,
      player.id,
      player.spaceId || 'street',
      'ground',
      player.x,
      player.y,
      player.angle,
      'player-controlled',
      player.alive,
      `circle:${ON_FOOT_PLAYER_RADIUS}`,
      phase,
      clock
    );
    if (!common) return undefined;
    return Object.freeze({
      ...common,
      kind: 'player',
      radius: ON_FOOT_PLAYER_RADIUS,
      movementMode: movementMode(common.velocityX, common.velocityY, intent),
      actionPhase: phase,
      actionTick: actionTick(this.tracks.get(entityKey('player', player.id)), clock.tick, phase),
      surfaceId: player.spaceId || 'street',
      alive: player.alive
    });
  }

  private projectNpc(npc: NpcState, clock: InteractionClock): HumanoidInteractionState | undefined {
    const phase = humanoidActionPhase(npc.action, npc.reactionKind);
    const common = this.commonState(
      'pedestrian',
      npc,
      npc.id,
      'street',
      'ground',
      npc.x,
      npc.y,
      npc.angle,
      this.options.priorityFor?.('pedestrian', npc.id) ?? 'ambient',
      npc.alive,
      `circle:${PEDESTRIAN_RADIUS}`,
      phase,
      clock
    );
    if (!common) return undefined;
    return Object.freeze({
      ...common,
      kind: 'pedestrian',
      radius: PEDESTRIAN_RADIUS,
      movementMode: movementMode(common.velocityX, common.velocityY),
      actionPhase: phase,
      actionTick: actionTick(
        this.tracks.get(entityKey('pedestrian', npc.id)),
        clock.tick,
        phase
      ),
      surfaceId: 'street',
      alive: npc.alive
    });
  }

  private projectVehicle(
    vehicle: VehicleState,
    clock: InteractionClock,
    intent?: InteractionAppliedIntent
  ): InteractionEntityState | undefined {
    if (!isVehicleKind(vehicle.kind)) return undefined;
    const definition = vehicleDefinition(vehicle.kind);
    const common = this.commonState(
      'vehicle',
      vehicle,
      vehicle.id,
      'street',
      'ground',
      vehicle.x,
      vehicle.y,
      vehicle.angle,
      vehicle.driverId && this.options.state.players.has(vehicle.driverId)
        ? 'player-controlled'
        : this.options.priorityFor?.('vehicle', vehicle.id) ?? 'ambient',
      !vehicle.destroyed,
      `obb:${vehicle.kind}:${definition.collision.length}:${definition.collision.width}`,
      'free',
      clock,
      {
        velocityX: Math.cos(vehicle.angle) * finite(vehicle.speed),
        velocityY: Math.sin(vehicle.angle) * finite(vehicle.speed)
      }
    );
    if (!common) return undefined;
    return Object.freeze({
      ...common,
      kind: 'vehicle',
      vehicleKind: vehicle.kind,
      speed: finite(vehicle.speed),
      steering: clamp(intent?.inputX ?? 0, -1, 1),
      engineDamage: clamp(finite(vehicle.engineDamage), 0, 250),
      onFire: Boolean(vehicle.onFire),
      destroyed: Boolean(vehicle.destroyed)
    });
  }

  private projectProjectile(
    projectile: {id: string; x: number; y: number; angle: number},
    radius: number,
    ownerId: string,
    clock: InteractionClock,
    motion?: InteractionProjectileMotion
  ): InteractionEntityState | undefined {
    const common = this.commonState(
      'projectile',
      projectile,
      projectile.id,
      'street',
      'ground',
      projectile.x,
      projectile.y,
      projectile.angle,
      this.options.state.players.has(ownerId)
        ? 'player-controlled'
        : this.options.priorityFor?.('projectile', projectile.id) ?? 'ambient',
      true,
      `circle:${radius}`,
      'free',
      clock,
      motion
    );
    if (!common) return undefined;
    return Object.freeze({...common, kind: 'projectile', radius, ownerId});
  }

  private commonState(
    kind: InteractionEntityState['kind'],
    object: object,
    id: string,
    spaceId: string,
    layerId: string,
    x: number,
    y: number,
    angle: number,
    interactionPriority: InteractionPhysicalPriority,
    lifecycleActive: boolean,
    colliderSignature: string,
    actionPhase: HumanoidInteractionState['actionPhase'],
    clock: InteractionClock,
    exactMotion?: InteractionProjectileMotion
  ): KinematicInteractionState | undefined {
    if (!id || !spaceId || !layerId || ![x, y, angle].every(Number.isFinite)) return undefined;
    const key = entityKey(kind, id);
    const previous = this.tracks.get(key);
    const lifecycleChanged = Boolean(previous && (
      previous.object !== object ||
      previous.lastSeenTick < clock.tick - 1 ||
      (!previous.lifecycleActive && lifecycleActive)
    ));
    const lifecycleRevision = previous
      ? previous.lifecycleRevision + (lifecycleChanged ? 1 : 0)
      : 1;
    const colliderRevision = previous
      ? previous.colliderRevision + (previous.colliderSignature === colliderSignature ? 0 : 1)
      : 1;
    const deltaSeconds = previous && !lifecycleChanged
      ? Math.max(0, clock.nowMs - previous.lastTimeMs) / 1_000
      : 0;
    const derivedVelocityX = deltaSeconds > 0 ? (x - (previous?.x ?? x)) / deltaSeconds : 0;
    const derivedVelocityY = deltaSeconds > 0 ? (y - (previous?.y ?? y)) / deltaSeconds : 0;
    const velocityX = Number.isFinite(exactMotion?.velocityX)
      ? exactMotion!.velocityX
      : derivedVelocityX;
    const velocityY = Number.isFinite(exactMotion?.velocityY)
      ? exactMotion!.velocityY
      : derivedVelocityY;
    const angularVelocity = deltaSeconds > 0
      ? normalizeAngle(angle - (previous?.angle ?? angle)) / deltaSeconds
      : 0;
    const actionPhaseStartedAtTick = previous?.actionPhase === actionPhase && !lifecycleChanged
      ? previous.actionPhaseStartedAtTick
      : clock.tick;
    this.tracks.set(key, {
      object,
      lifecycleActive,
      lifecycleRevision,
      colliderSignature,
      colliderRevision,
      lastSeenTick: clock.tick,
      lastTimeMs: clock.nowMs,
      x,
      y,
      angle,
      actionPhase,
      actionPhaseStartedAtTick
    });
    return Object.freeze({
      id,
      kind,
      spaceId,
      layerId,
      x,
      y,
      angle: normalizeAngle(angle),
      velocityX: finite(velocityX),
      velocityY: finite(velocityY),
      angularVelocity: finite(angularVelocity),
      colliderRevision,
      lifecycleRevision,
      interactionPriority
    });
  }

  private pin(playerId: string, snapshot: InteractionSnapshot): void {
    const history = this.histories.get(playerId) ?? [];
    if (history.at(-1)?.serverTick === snapshot.serverTick) history.pop();
    history.push(snapshot);
    const minimumTick = snapshot.serverTick - this.historyTicks + 1;
    while (history[0] && history[0].serverTick < minimumTick) history.shift();
    this.histories.set(playerId, history);
  }

  private pruneTracks(currentTick: number): void {
    const minimumTick = currentTick - this.historyTicks;
    for (const [key, track] of this.tracks) {
      if (track.lastSeenTick < minimumTick) this.tracks.delete(key);
    }
    for (const [playerId, track] of this.controlTracks) {
      if (track.lastSeenTick < minimumTick) this.controlTracks.delete(playerId);
    }
  }
}

function entityKey(kind: InteractionEntityState['kind'], id: string): string {
  return `${kind}:${id}`;
}

function appliedIntent(
  entityId: string,
  tick: number,
  moveX: number,
  moveY: number,
  steering: number,
  throttle: number,
  movementScale: number
): RemoteIntentState {
  return Object.freeze({
    entityId,
    appliedAtServerTick: tick,
    moveX: clamp(finite(moveX), -1, 1),
    moveY: clamp(finite(moveY), -1, 1),
    steering: clamp(finite(steering), -1, 1),
    throttle: clamp(finite(throttle), -1, 1),
    movementScale: clamp(finite(movementScale), 0, 2)
  });
}

function humanoidActionPhase(
  action: string,
  reactionKind: string
): HumanoidInteractionState['actionPhase'] {
  if (action === 'melee') return 'melee';
  if (action === 'reload') return 'reload';
  if (action === 'entering' || action === 'hijacking') return 'entering';
  if (action === 'knockdown' || reactionKind === 'knockdown') return 'knockdown';
  if (action === 'hit' || reactionKind === 'flinch' || reactionKind === 'stagger') return 'hit';
  return 'free';
}

function movementMode(
  velocityX: number,
  velocityY: number,
  intent?: InteractionAppliedIntent
): HumanoidInteractionState['movementMode'] {
  const speed = Math.hypot(velocityX, velocityY);
  if (speed < 1) return 'idle';
  const requestedMagnitude = intent ? Math.hypot(intent.inputX, intent.inputY) : speed / ON_FOOT_PLAYER_SPEED;
  return requestedMagnitude > 0.72 ? 'run' : 'walk';
}

function actionTick(
  track: EntityTrack | undefined,
  tick: number,
  phase: HumanoidInteractionState['actionPhase']
): number {
  return phase === 'free' || !track ? 0 : Math.max(0, tick - track.actionPhaseStartedAtTick);
}

function nonnegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be positive.`);
  return value;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

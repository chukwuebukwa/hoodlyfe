import {performance} from 'node:perf_hooks';
import type {
  HumanoidInteractionState,
  InteractionControlMode,
  InteractionEntityState,
  InteractionSnapshot,
  PropInteractionState,
  VehicleInteractionState
} from '../../shared/protocol/interaction-contracts.ts';
import {
  INTERACTION_PROTOCOL_VERSION,
  validateInteractionSnapshot
} from '../../shared/protocol/interaction-simulation.ts';
import {
  replayInteractionIsland,
  type InteractionReplayBatchStep,
  type InteractionReplayBodyStep,
  type InteractionReplayCommand,
  type InteractionReplayStepContext
} from '../../src/game/prediction/interaction-island-replay.ts';
import {createVehiclePhysicsBatchStep} from '../../src/game/prediction/vehicle-physics-replay.ts';
import {PhysicsWorld} from '../../shared/physics/physics-world.ts';
import type {InteractionReplayControl} from '../../src/game/prediction/remote-intent-continuation.ts';
import {InteractionIslandSelector} from '../../src/game/prediction/interaction-island-selector.ts';
import {IslandStateHistory} from '../../src/game/prediction/island-state-history.ts';
import {createMixedInteractionBodyStep} from '../../src/game/prediction/mixed-interaction-replay.ts';
import {ReplaySideEffectGate} from '../../src/game/prediction/replay-side-effect-gate.ts';
import {
  DESKTOP_INTERACTION_ISLAND_BUDGET,
  interactionStableKey
} from '../../src/game/prediction/interaction-island-policy.ts';
import {
  DeterministicReliableNetworkLink,
  type NetworkImpairmentProfile
} from './deterministic-network-link.ts';

export const M11_ACCEPTANCE_PROFILE: NetworkImpairmentProfile = Object.freeze({
  id: 'continental',
  roundTripTimeMs: 150,
  jitterMs: 30,
  packetLossRate: 0.01,
  retransmissionPenaltyMs: 150
});

export const M11_STRESS_PROFILE: NetworkImpairmentProfile = Object.freeze({
  id: 'intercontinental',
  roundTripTimeMs: 250,
  jitterMs: 45,
  packetLossRate: 0.02,
  retransmissionPenaltyMs: 250
});

export interface InteractionIslandSoakResult {
  readonly profile: NetworkImpairmentProfile;
  readonly clients: number;
  readonly ticks: number;
  readonly successfulReplays: number;
  readonly rejectedReplays: number;
  readonly maximumReplayTicks: number;
  readonly maximumIslandBodies: number;
  readonly maximumWeightedPoints: number;
  readonly budgetViolations: number;
  readonly overflowSelections: number;
  readonly replayDurationP95Ms: number;
  readonly replayDurationMaximumMs: number;
  readonly rootErrorP95: number;
  readonly rootErrorMaximum: number;
  readonly finalConvergenceError: number;
  readonly suppressedExternalEffects: number;
  readonly executedExternalEffects: number;
  readonly simulatedRetransmissions: number;
  readonly occupancyTransitionsObserved: number;
  readonly historyResetsObserved: number;
  readonly streamOutObserved: boolean;
  readonly streamInObserved: boolean;
  readonly destructionObserved: boolean;
  readonly vehicleRespawnObserved: boolean;
  readonly humanoidRespawnObserved: boolean;
}

interface SoakClient {
  readonly id: string;
  readonly link: DeterministicReliableNetworkLink<InteractionSnapshot>;
  readonly selector: InteractionIslandSelector;
  readonly history: IslandStateHistory;
  readonly stepBatch: InteractionReplayBatchStep;
  lastRootId?: string;
  finalError: number;
}

interface MutableWorld {
  readonly entities: Map<string, InteractionEntityState>;
  readonly streamed: Map<string, InteractionEntityState>;
}

interface MutableMetrics {
  successfulReplays: number;
  rejectedReplays: number;
  maximumReplayTicks: number;
  maximumIslandBodies: number;
  maximumWeightedPoints: number;
  budgetViolations: number;
  overflowSelections: number;
  suppressedExternalEffects: number;
  executedExternalEffects: number;
  occupancyTransitionsObserved: number;
  historyResetsObserved: number;
  streamOutObserved: boolean;
  streamInObserved: boolean;
  destructionObserved: boolean;
  vehicleRespawnObserved: boolean;
  humanoidRespawnObserved: boolean;
}

const STEP_SECONDS = 1 / 30;
const STEP_MS = STEP_SECONDS * 1_000;
const SNAPSHOT_INTERVAL_TICKS = 2;
const WORLD_COLLISION_REVISION = 1;
const CLIENT_IDS = Object.freeze(Array.from({length: 8}, (_, index) => `client-${index}`));
const STREAMED_IDS = Object.freeze(['vehicle-10', 'vehicle-11', 'pedestrian-14', 'pedestrian-15']);
const bodyStep = createMixedInteractionBodyStep(() => true);

// Open geometry covering the soak coordinate range; used when the soak runs the
// server-vehicle-physics stage on both sides of the simulated wire.
const SOAK_PHYSICS_GEOMETRY = Object.freeze({
  width: 64,
  height: 64,
  tileWidth: 64,
  tileHeight: 64,
  collisions: Object.freeze(new Array(64 * 64).fill(0)) as readonly number[]
});

export function runInteractionIslandSoak(
  profile: NetworkImpairmentProfile,
  ticks = 450,
  seed = 0x51a7
): InteractionIslandSoakResult {
  const engine = {
    authority: PhysicsWorld.create(SOAK_PHYSICS_GEOMETRY),
    clients: new Map(CLIENT_IDS.map((id) => [id, PhysicsWorld.create(SOAK_PHYSICS_GEOMETRY)]))
  };
  try {
    return runSoak(profile, ticks, seed, engine);
  } finally {
    engine.authority.free();
    for (const world of engine.clients.values()) world.free();
  }
}

interface SoakPhysics {
  authority: PhysicsWorld;
  clients: ReadonlyMap<string, PhysicsWorld>;
}

function runSoak(
  profile: NetworkImpairmentProfile,
  ticks: number,
  seed: number,
  engine: SoakPhysics
): InteractionIslandSoakResult {
  const world = createWorld();
  const authorityBatch = createVehiclePhysicsBatchStep(engine.authority);
  const clients = CLIENT_IDS.map((id, index): SoakClient => ({
    id,
    link: new DeterministicReliableNetworkLink(profile, seed + index * 0x101),
    selector: new InteractionIslandSelector(),
    history: new IslandStateHistory(),
    finalError: Number.POSITIVE_INFINITY,
    stepBatch: createVehiclePhysicsBatchStep(engine.clients.get(id)!)
  }));
  const metrics = initialMetrics();
  const replayDurations: number[] = [];
  const rootErrors: number[] = [];

  for (let tick = 1; tick <= ticks; tick++) {
    applyLifecycleEvents(world, tick);
    stepAuthority(world, tick, authorityBatch);
    const nowMs = tick * STEP_MS;
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      for (const client of clients) {
        client.link.send(nowMs, snapshotFor(world, client.id, tick));
      }
    }
    for (const client of clients) {
      for (const snapshot of client.link.receive(nowMs)) {
        processSnapshot(
          world,
          client,
          snapshot,
          tick,
          profile,
          metrics,
          replayDurations,
          rootErrors
        );
      }
    }
  }

  const finalNowMs = ticks * STEP_MS;
  for (const client of clients) {
    client.link.send(finalNowMs, snapshotFor(world, client.id, ticks));
  }
  const flushAtMs = finalNowMs + profile.roundTripTimeMs + profile.jitterMs +
    profile.retransmissionPenaltyMs + 1_000;
  for (const client of clients) {
    for (const snapshot of client.link.receive(flushAtMs)) {
      processSnapshot(
        world,
        client,
        snapshot,
        ticks,
        profile,
        metrics,
        replayDurations,
        rootErrors
      );
    }
  }

  const retransmissions = clients.reduce((sum, client) => (
    sum + client.link.diagnostics().simulatedRetransmissions
  ), 0);
  const sortedDurations = replayDurations.sort((left, right) => left - right);
  const sortedErrors = rootErrors.sort((left, right) => left - right);
  return Object.freeze({
    profile,
    clients: clients.length,
    ticks,
    successfulReplays: metrics.successfulReplays,
    rejectedReplays: metrics.rejectedReplays,
    maximumReplayTicks: metrics.maximumReplayTicks,
    maximumIslandBodies: metrics.maximumIslandBodies,
    maximumWeightedPoints: metrics.maximumWeightedPoints,
    budgetViolations: metrics.budgetViolations,
    overflowSelections: metrics.overflowSelections,
    replayDurationP95Ms: percentile(sortedDurations, 0.95),
    replayDurationMaximumMs: sortedDurations.at(-1) ?? 0,
    rootErrorP95: percentile(sortedErrors, 0.95),
    rootErrorMaximum: sortedErrors.at(-1) ?? 0,
    finalConvergenceError: Math.max(...clients.map(({finalError}) => finalError)),
    suppressedExternalEffects: metrics.suppressedExternalEffects,
    executedExternalEffects: metrics.executedExternalEffects,
    simulatedRetransmissions: retransmissions,
    occupancyTransitionsObserved: metrics.occupancyTransitionsObserved,
    historyResetsObserved: metrics.historyResetsObserved,
    streamOutObserved: metrics.streamOutObserved,
    streamInObserved: metrics.streamInObserved,
    destructionObserved: metrics.destructionObserved,
    vehicleRespawnObserved: metrics.vehicleRespawnObserved,
    humanoidRespawnObserved: metrics.humanoidRespawnObserved
  });
}

function processSnapshot(
  world: MutableWorld,
  client: SoakClient,
  snapshot: InteractionSnapshot,
  targetTick: number,
  profile: NetworkImpairmentProfile,
  metrics: MutableMetrics,
  replayDurations: number[],
  rootErrors: number[]
): void {
  observeLifecycle(snapshot, metrics);
  const selection = client.selector.select(snapshot, {
    budget: DESKTOP_INTERACTION_ISLAND_BUDGET,
    network: {
      rttMs: profile.roundTripTimeMs,
      interpolationDelayMs: 100,
      jitterMs: profile.jitterMs
    }
  });
  if (!selection) return;
  metrics.maximumIslandBodies = Math.max(metrics.maximumIslandBodies, selection.members.length);
  metrics.maximumWeightedPoints = Math.max(metrics.maximumWeightedPoints, selection.weightedPoints);
  if (selection.weightedPoints > selection.budget) metrics.budgetViolations++;
  if (selection.overflowIds.length > 0) metrics.overflowSelections++;

  const previous = client.history.latest();
  const baseline = client.history.record(snapshot, selection);
  if (!baseline) return;
  if (client.lastRootId && client.lastRootId !== baseline.rootId) {
    metrics.occupancyTransitionsObserved++;
    if (previous && client.history.size() === 1) metrics.historyResetsObserved++;
  }
  client.lastRootId = baseline.rootId;

  let executedExternalEffects = 0;
  const sideEffects = new ReplaySideEffectGate();
  const instrumentedBodyStep: InteractionReplayBodyStep = (entity, control, context) => {
    if (entity.id === baseline.rootId) {
      context.sideEffects.dispatch('one-shot-presentation', () => executedExternalEffects++);
      context.sideEffects.dispatch('authoritative-gameplay', () => executedExternalEffects++);
      context.sideEffects.dispatch('durable-transaction', () => executedExternalEffects++);
    }
    return bodyStep(entity, control, context);
  };
  const startedAt = performance.now();
  const replay = replayInteractionIsland({
    baseline,
    targetServerTick: targetTick,
    expectedWorldCollisionRevision: WORLD_COLLISION_REVISION,
    localCommands: localCommands(baseline.rootId, baseline.serverTick, targetTick),
    stepBody: instrumentedBodyStep,
    stepBatch: client.stepBatch,
    sideEffects
  });
  replayDurations.push(performance.now() - startedAt);
  metrics.executedExternalEffects += executedExternalEffects;
  if (!replay.replayed) {
    metrics.rejectedReplays++;
    return;
  }
  metrics.successfulReplays++;
  metrics.maximumReplayTicks = Math.max(metrics.maximumReplayTicks, replay.replayedTicks);
  metrics.suppressedExternalEffects += Object.values(replay.suppressedEffects)
    .reduce((sum, count) => sum + count, 0);
  const predictedRoot = replay.entities[0];
  const currentRootId = rootFor(client.id, targetTick);
  const authoritativeRoot = world.entities.get(currentRootId);
  if (
    baseline.rootId !== currentRootId ||
    !authoritativeRoot ||
    predictedRoot.kind !== authoritativeRoot.kind ||
    predictedRoot.lifecycleRevision !== authoritativeRoot.lifecycleRevision
  ) return;
  const error = Math.hypot(
    predictedRoot.x - authoritativeRoot.x,
    predictedRoot.y - authoritativeRoot.y
  );
  rootErrors.push(error);
  client.finalError = error;
}

function stepAuthority(
  world: MutableWorld,
  serverTick: number,
  batch: InteractionReplayBatchStep
): void {
  const sideEffects = new ReplaySideEffectGate();
  const context: InteractionReplayStepContext = Object.freeze({
    serverTick,
    deltaSeconds: STEP_SECONDS,
    sideEffects
  });
  const entities = stableEntities(world.entities);
  const controls = new Map(entities.map((entity) => [
    entity.id,
    controlFor(entity.id, serverTick)
  ]));
  const batched = batch(entities, controls, context);
  const stepped = new Map<string, InteractionEntityState>();
  for (const entity of entities) {
    const next = batched?.get(entity.id) ?? bodyStep(entity, controls.get(entity.id)!, context);
    stepped.set(next.id, next);
  }
  world.entities.clear();
  for (const [id, entity] of stepped) world.entities.set(id, entity);
}

function snapshotFor(world: MutableWorld, clientId: string, serverTick: number): InteractionSnapshot {
  const rootId = rootFor(clientId, serverTick);
  const root = world.entities.get(rootId);
  if (!root) throw new Error(`Missing soak root ${rootId} at tick ${serverTick}.`);
  const entities = [root, ...stableEntities(world.entities).filter(({id}) => id !== rootId)];
  const raw: InteractionSnapshot = {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    serverTimeMs: serverTick * STEP_MS,
    worldCollisionRevision: WORLD_COLLISION_REVISION,
    controlRevision: controlRevisionFor(clientId, serverTick),
    controlMode: controlModeFor(root),
    acknowledgedLocalInputSequence: serverTick,
    confirmedEventsThrough: serverTick,
    entities,
    remoteIntents: entities.slice(1).map((entity) => {
      const control = controlFor(entity.id, serverTick);
      return Object.freeze({
        entityId: entity.id,
        appliedAtServerTick: serverTick,
        moveX: control.moveX,
        moveY: control.moveY,
        steering: control.steering,
        throttle: control.throttle,
        movementScale: control.movementScale
      });
    })
  };
  const validated = validateInteractionSnapshot(raw, {
    currentServerTick: serverTick,
    expectedWorldCollisionRevision: WORLD_COLLISION_REVISION
  });
  if (!validated.accepted) {
    throw new Error(`Generated soak snapshot rejected: ${validated.reason}.`);
  }
  return validated.value;
}

function createWorld(): MutableWorld {
  const entities = new Map<string, InteractionEntityState>();
  for (let index = 0; index < 12; index++) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const entity = vehicle(
      `vehicle-${index}`,
      2_000 + column * 58,
      2_000 + row * 70,
      index % 2 === 0 ? 0 : Math.PI,
      index < 8 ? 34 : 0
    );
    entities.set(entity.id, entity);
  }
  for (let index = 0; index < 8; index++) {
    const entity = humanoid(
      `player-${index}`,
      'player',
      1_978 + (index % 4) * 58,
      2_035 + Math.floor(index / 4) * 88,
      'player-controlled'
    );
    entities.set(entity.id, entity);
  }
  for (let index = 0; index < 16; index++) {
    const entity = humanoid(
      `pedestrian-${index}`,
      'pedestrian',
      1_960 + (index % 8) * 34,
      1_955 + Math.floor(index / 8) * 155,
      index < 2 ? 'mission-critical' : 'ambient'
    );
    entities.set(entity.id, entity);
  }
  for (let index = 0; index < 12; index++) {
    const entity = prop(
      `prop-${index}`,
      1_986 + (index % 6) * 18,
      1_982 + Math.floor(index / 6) * 34
    );
    entities.set(entity.id, entity);
  }
  return {entities, streamed: new Map()};
}

function applyLifecycleEvents(world: MutableWorld, tick: number): void {
  if (tick === 120) {
    for (const id of STREAMED_IDS) {
      const entity = world.entities.get(id);
      if (!entity) continue;
      world.streamed.set(id, entity);
      world.entities.delete(id);
    }
  }
  if (tick === 180) {
    for (const [id, entity] of world.streamed) {
      world.entities.set(id, cloneEntity(entity, {
        x: entity.x + 24,
        y: entity.y - 18,
        lifecycleRevision: entity.lifecycleRevision + 1,
        colliderRevision: entity.colliderRevision + 1
      }));
    }
    world.streamed.clear();
    world.entities.delete('player-0');
  }
  if (tick === 220) {
    const entity = world.entities.get('vehicle-8');
    if (entity?.kind === 'vehicle') {
      world.entities.set(entity.id, Object.freeze({
        ...entity,
        speed: 0,
        velocityX: 0,
        velocityY: 0,
        destroyed: true,
        colliderRevision: entity.colliderRevision + 1
      }));
    }
  }
  if (tick === 260) {
    const entity = world.entities.get('vehicle-8');
    if (entity?.kind === 'vehicle') {
      world.entities.set(entity.id, Object.freeze({
        ...entity,
        x: 2_190,
        y: 2_145,
        angle: 0,
        speed: 0,
        velocityX: 0,
        velocityY: 0,
        destroyed: false,
        lifecycleRevision: entity.lifecycleRevision + 1,
        colliderRevision: entity.colliderRevision + 1
      }));
    }
  }
  if (tick === 280) {
    const entity = world.entities.get('pedestrian-10');
    if (entity?.kind === 'pedestrian') {
      world.entities.set(entity.id, Object.freeze({...entity, alive: false}));
    }
  }
  if (tick === 300) {
    const vehicle = world.entities.get('vehicle-0');
    if (vehicle?.kind !== 'vehicle') throw new Error('Missing occupancy vehicle.');
    world.entities.set('player-0', humanoid(
      'player-0',
      'player',
      vehicle.x + 34,
      vehicle.y,
      'player-controlled',
      2,
      2
    ));
  }
  if (tick === 320) {
    const entity = world.entities.get('pedestrian-10');
    if (entity?.kind === 'pedestrian') {
      world.entities.set(entity.id, Object.freeze({
        ...entity,
        x: 2_075,
        y: 2_170,
        alive: true,
        lifecycleRevision: entity.lifecycleRevision + 1,
        colliderRevision: entity.colliderRevision + 1
      }));
    }
  }
}

function observeLifecycle(snapshot: InteractionSnapshot, metrics: MutableMetrics): void {
  const byId = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  if (
    snapshot.serverTick >= 120 && snapshot.serverTick < 180 &&
    STREAMED_IDS.every((id) => !byId.has(id))
  ) metrics.streamOutObserved = true;
  if (
    snapshot.serverTick >= 180 &&
    STREAMED_IDS.every((id) => (byId.get(id)?.lifecycleRevision ?? 0) >= 2)
  ) metrics.streamInObserved = true;
  const vehicle = byId.get('vehicle-8');
  if (vehicle?.kind === 'vehicle' && vehicle.destroyed) metrics.destructionObserved = true;
  if (
    snapshot.serverTick >= 260 && vehicle?.kind === 'vehicle' &&
    !vehicle.destroyed && vehicle.lifecycleRevision >= 2
  ) metrics.vehicleRespawnObserved = true;
  const humanoid = byId.get('pedestrian-10');
  if (
    snapshot.serverTick >= 320 && humanoid?.kind === 'pedestrian' &&
    humanoid.alive && humanoid.lifecycleRevision >= 2
  ) metrics.humanoidRespawnObserved = true;
}

function localCommands(
  rootId: string,
  baselineTick: number,
  targetTick: number
): InteractionReplayCommand[] {
  return Array.from({length: targetTick - baselineTick}, (_, index) => {
    const serverTick = baselineTick + index + 1;
    const control = controlFor(rootId, serverTick);
    return Object.freeze({
      serverTick,
      entityId: rootId,
      moveX: control.moveX,
      moveY: control.moveY,
      steering: control.steering,
      throttle: control.throttle,
      movementScale: control.movementScale
    });
  });
}

function controlFor(entityId: string, tick: number): InteractionReplayControl {
  const index = numericSuffix(entityId);
  const phase = Math.floor((tick + index * 11) / 90) % 4;
  if (entityId.startsWith('vehicle-')) {
    return Object.freeze({
      moveX: 0,
      moveY: 0,
      steering: phase === 1 ? 0.35 : phase === 3 ? -0.3 : 0,
      throttle: phase === 2 ? 0.1 : 0.42,
      movementScale: 1,
      source: 'local'
    });
  }
  if (entityId.startsWith('prop-')) {
    return Object.freeze({
      moveX: 0,
      moveY: 0,
      steering: 0,
      throttle: 0,
      movementScale: 1,
      source: 'local'
    });
  }
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
  const [moveX, moveY] = directions[phase];
  return Object.freeze({
    moveX,
    moveY,
    steering: 0,
    throttle: 0,
    movementScale: entityId.startsWith('player-') ? 1 : 0.7,
    source: 'local'
  });
}

function rootFor(clientId: string, tick: number): string {
  const index = numericSuffix(clientId);
  if (index === 0) return tick >= 180 && tick < 300 ? 'vehicle-0' : 'player-0';
  if (index <= 3) return `vehicle-${index}`;
  return `player-${index}`;
}

function controlRevisionFor(clientId: string, tick: number): number {
  if (clientId !== 'client-0') return 1;
  if (tick >= 300) return 3;
  if (tick >= 180) return 2;
  return 1;
}

function controlModeFor(root: InteractionEntityState): InteractionControlMode {
  return root.kind === 'vehicle' ? 'driver' : 'on-foot';
}

function vehicle(
  id: string,
  x: number,
  y: number,
  angle: number,
  speed: number
): VehicleInteractionState {
  return Object.freeze({
    id,
    kind: 'vehicle',
    spaceId: 'street',
    layerId: 'ground',
    surfaceId: 'street-ground',
    x,
    y,
    angle,
    velocityX: Math.cos(angle) * speed,
    velocityY: Math.sin(angle) * speed,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: id === 'vehicle-0' ? 'player-controlled' : 'ambient',
    vehicleKind: 'sedan',
    speed,
    steering: 0,
    engineDamage: 0,
    tyreDamageMask: 0,
    onFire: false,
    destroyed: false
  });
}

function humanoid(
  id: string,
  kind: 'player' | 'pedestrian',
  x: number,
  y: number,
  interactionPriority: HumanoidInteractionState['interactionPriority'],
  lifecycleRevision = 1,
  colliderRevision = 1
): HumanoidInteractionState {
  return Object.freeze({
    id,
    kind,
    spaceId: 'street',
    layerId: 'ground',
    x,
    y,
    angle: 0,
    velocityX: 0,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision,
    lifecycleRevision,
    interactionPriority,
    radius: 11,
    movementMode: 'run',
    actionPhase: 'free',
    actionTick: 0,
    surfaceId: 'street',
    alive: true
  });
}

function prop(id: string, x: number, y: number): PropInteractionState {
  return Object.freeze({
    id,
    kind: 'prop',
    spaceId: 'street',
    layerId: 'ground',
    surfaceId: 'street-ground',
    x,
    y,
    angle: 0,
    velocityX: 0,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: 'ambient',
    radius: 10,
    mass: 80
  });
}

function cloneEntity(
  entity: InteractionEntityState,
  changes: Partial<InteractionEntityState>
): InteractionEntityState {
  return Object.freeze({...entity, ...changes}) as InteractionEntityState;
}

function stableEntities(entities: ReadonlyMap<string, InteractionEntityState>): InteractionEntityState[] {
  return [...entities.values()].sort((left, right) => (
    interactionStableKey(left).localeCompare(interactionStableKey(right))
  ));
}

function numericSuffix(id: string): number {
  const value = Number(id.slice(id.lastIndexOf('-') + 1));
  return Number.isSafeInteger(value) ? value : 0;
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

function initialMetrics(): MutableMetrics {
  return {
    successfulReplays: 0,
    rejectedReplays: 0,
    maximumReplayTicks: 0,
    maximumIslandBodies: 0,
    maximumWeightedPoints: 0,
    budgetViolations: 0,
    overflowSelections: 0,
    suppressedExternalEffects: 0,
    executedExternalEffects: 0,
    occupancyTransitionsObserved: 0,
    historyResetsObserved: 0,
    streamOutObserved: false,
    streamInObserved: false,
    destructionObserved: false,
    vehicleRespawnObserved: false,
    humanoidRespawnObserved: false
  };
}

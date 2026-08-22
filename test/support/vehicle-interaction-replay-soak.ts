import {performance} from 'node:perf_hooks';
import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  INTERACTION_PROTOCOL_VERSION,
  validateInteractionSnapshot,
  type InteractionBodyState,
  type InteractionContactPair,
  type InteractionIntentState,
  type InteractionSnapshot
} from '../../shared/protocol/interaction-islands.ts';
import {
  initializePhysicsEngine,
  PhysicsWorld,
  type PhysicsBodyState
} from '../../shared/physics/physics-world.ts';
import {
  captureVehicleBody,
  driveVehicleBody
} from '../../shared/simulation/vehicle-body-drive.ts';
import {
  VEHICLE_SIMULATION_STEP_SECONDS,
  type VehicleMotionState
} from '../../shared/simulation/vehicle-step.ts';
import {SIMULATION_STEP_MS} from '../../shared/simulation/timing.ts';
import {SurfaceMap, type SurfaceManifest} from '../../shared/world/surface-map.ts';
import {
  InteractionIslandSelector,
  MOBILE_INTERACTION_ISLAND_BUDGET
} from '../../src/game/network/interaction-island-selector.ts';
import {VehicleInteractionReplayController} from '../../src/game/network/vehicle-interaction-replay.ts';
import type {
  VehiclePredictionPendingMove,
  VehiclePredictionPose
} from '../../src/game/network/vehicle-prediction-controller.ts';
import {
  DeterministicReliableNetworkLink,
  type NetworkImpairmentProfile
} from './deterministic-network-link.ts';

const VEHICLE_COUNT = 8;
const ROOT_INDICES = Object.freeze([0, 2, 4, 6]);
const TOTAL_TICKS = 450;
const SNAPSHOT_INTERVAL_TICKS = 2;

export const VEHICLE_INTERACTION_REPLAY_PROFILES: readonly NetworkImpairmentProfile[] = Object.freeze([
  Object.freeze({
    id: 'continental',
    roundTripTimeMs: 150,
    jitterMs: 30,
    packetLossRate: 0.01,
    retransmissionPenaltyMs: 150
  }),
  Object.freeze({
    id: 'intercontinental',
    roundTripTimeMs: 250,
    jitterMs: 45,
    packetLossRate: 0.02,
    retransmissionPenaltyMs: 250
  })
]);

interface TimelineFrame {
  readonly states: ReadonlyMap<string, VehicleMotionState>;
  readonly contacts: readonly InteractionContactPair[];
}

interface ClientHarness {
  readonly rootKey: string;
  readonly selector: InteractionIslandSelector;
  readonly replay: VehicleInteractionReplayController;
  readonly link: DeterministicReliableNetworkLink<InteractionSnapshot>;
}

export interface VehicleInteractionReplaySoakResult {
  readonly profile: NetworkImpairmentProfile;
  readonly acceptedSnapshots: number;
  readonly rejectedSnapshots: number;
  readonly activeReplays: number;
  readonly maximumReplayTicks: number;
  readonly maximumBodies: number;
  readonly maximumWeightedPoints: number;
  readonly budgetViolations: number;
  readonly overflowSelections: number;
  readonly contactSnapshots: number;
  readonly retransmissions: number;
  readonly rootErrorP95: number;
  readonly maximumRootError: number;
  readonly replayDurationP95Ms: number;
  readonly finalConvergenceError: number;
  readonly deterministicTrace: readonly string[];
}

export async function runVehicleInteractionReplaySoak(
  profile: NetworkImpairmentProfile,
  seed: number
): Promise<VehicleInteractionReplaySoakResult> {
  await initializePhysicsEngine();
  const surfaces = new SurfaceMap(surfaceFixture());
  const timeline = buildAuthorityTimeline();
  const clients = await Promise.all(ROOT_INDICES.map(async (rootIndex) => ({
    rootKey: vehicleKey(rootIndex),
    selector: new InteractionIslandSelector(MOBILE_INTERACTION_ISLAND_BUDGET),
    replay: await VehicleInteractionReplayController.create(surfaces),
    link: new DeterministicReliableNetworkLink(profile, seed + rootIndex * 997)
  })));
  let acceptedSnapshots = 0;
  let rejectedSnapshots = 0;
  let activeReplays = 0;
  let maximumReplayTicks = 0;
  let maximumBodies = 0;
  let maximumWeightedPoints = 0;
  let budgetViolations = 0;
  let overflowSelections = 0;
  let contactSnapshots = 0;
  const rootErrors: number[] = [];
  const replayDurations: number[] = [];
  const deterministicTrace: string[] = [];

  try {
    for (let tick = 0; tick <= TOTAL_TICKS; tick++) {
      const nowMs = tick * SIMULATION_STEP_MS;
      if (tick % SNAPSHOT_INTERVAL_TICKS === 0) {
        for (const client of clients) {
          client.link.send(nowMs, snapshotAt(timeline, tick, client.rootKey));
        }
      }
      for (const client of clients) {
        for (const message of client.link.receive(nowMs)) {
          const validation = validateInteractionSnapshot(message, {
            currentServerTick: tick,
            expectedWorldCollisionRevision: 2,
            expectedStreamRevision: 1,
            expectedSurfaceRevision: 1,
            expectedControlRevision: 1,
            expectedRootBodyKey: client.rootKey
          });
          if (!validation.accepted) {
            rejectedSnapshots++;
            deterministicTrace.push(`${tick}:${client.rootKey}:reject:${validation.reason}`);
            continue;
          }
          acceptedSnapshots++;
          if (validation.value.contacts.length > 0) contactSnapshots++;
          const selection = client.selector.select(validation.value);
          if (!selection) throw new Error(`Missing selection for ${client.rootKey}.`);
          maximumBodies = Math.max(maximumBodies, selection.members.length);
          maximumWeightedPoints = Math.max(maximumWeightedPoints, selection.weightedPoints);
          if (selection.weightedPoints > selection.budgetPoints) budgetViolations++;
          if (selection.overflowBodyKeys.length > 0) overflowSelections++;
          const startedAt = performance.now();
          const observation = client.replay.evaluate({
            snapshot: validation.value,
            selection,
            pendingMoves: pendingMoves(timeline, validation.value.serverTick, tick, client.rootKey),
            currentLocalPose: poseAt(timeline, tick, client.rootKey)
          });
          replayDurations.push(performance.now() - startedAt);
          if (observation.active) {
            activeReplays++;
            maximumReplayTicks = Math.max(maximumReplayTicks, observation.replayTicks);
            rootErrors.push(observation.correctionErrorPx);
          }
          deterministicTrace.push([
            tick,
            client.rootKey,
            validation.value.serverTick,
            selection.bodyKeys.join(','),
            selection.weightedPoints,
            selection.overflowBodyKeys.length,
            observation.reason,
            observation.replayTicks,
            observation.rootPose?.x.toFixed(5) ?? '-',
            observation.rootPose?.y.toFixed(5) ?? '-'
          ].join(':'));
        }
      }
    }

    let finalConvergenceError = 0;
    for (const client of clients) {
      const finalSnapshot = snapshotAt(timeline, TOTAL_TICKS, client.rootKey);
      const selection = client.selector.select(finalSnapshot);
      if (!selection) throw new Error(`Missing final selection for ${client.rootKey}.`);
      const authority = poseAt(timeline, TOTAL_TICKS, client.rootKey);
      const final = client.replay.evaluate({
        snapshot: finalSnapshot,
        selection,
        pendingMoves: Object.freeze([]),
        currentLocalPose: authority
      });
      if (!final.rootPose) throw new Error(`Missing final replay pose for ${client.rootKey}.`);
      finalConvergenceError = Math.max(
        finalConvergenceError,
        Math.hypot(final.rootPose.x - authority.x, final.rootPose.y - authority.y)
      );
    }

    return Object.freeze({
      profile,
      acceptedSnapshots,
      rejectedSnapshots,
      activeReplays,
      maximumReplayTicks,
      maximumBodies,
      maximumWeightedPoints,
      budgetViolations,
      overflowSelections,
      contactSnapshots,
      retransmissions: clients.reduce(
        (sum, client) => sum + client.link.diagnostics().simulatedRetransmissions,
        0
      ),
      rootErrorP95: percentile(rootErrors, 0.95),
      maximumRootError: Math.max(0, ...rootErrors),
      replayDurationP95Ms: percentile(replayDurations, 0.95),
      finalConvergenceError,
      deterministicTrace: Object.freeze(deterministicTrace)
    });
  } finally {
    for (const client of clients) client.replay.destroy();
  }
}

function buildAuthorityTimeline(): readonly TimelineFrame[] {
  const world = PhysicsWorld.create(emptyPhysicsGeometry());
  let states = initialStates();
  for (const [key, state] of states) world.registerVehicle(key, 'sedan', physicsState(state));
  const timeline: TimelineFrame[] = [frame(world, states)];
  try {
    for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
      const desired = new Map<string, VehicleMotionState>();
      for (const [key, state] of states) {
        desired.set(key, driveVehicleBody(
          world,
          key,
          'sedan',
          state,
          {steering: 0, throttle: 0},
          VEHICLE_SIMULATION_STEP_SECONDS
        ));
      }
      world.step();
      const next = new Map<string, VehicleMotionState>();
      for (const [key] of states) {
        const captured = captureVehicleBody(world, key, desired.get(key)!);
        if (!captured) throw new Error(`Authority failed to capture ${key}.`);
        next.set(key, Object.freeze(captured.pose));
      }
      states = next;
      timeline.push(frame(world, states));
    }
    return Object.freeze(timeline);
  } finally {
    world.free();
  }
}

function initialStates(): Map<string, VehicleMotionState> {
  const states = new Map<string, VehicleMotionState>();
  for (let pair = 0; pair < VEHICLE_COUNT / 2; pair++) {
    const y = -900 + pair * 600;
    states.set(vehicleKey(pair * 2), motion(-26, y, 72));
    states.set(vehicleKey(pair * 2 + 1), motion(26, y, -36));
  }
  return states;
}

function motion(x: number, y: number, linvelX: number): VehicleMotionState {
  return Object.freeze({
    x,
    y,
    angle: linvelX < 0 ? Math.PI : 0,
    speed: Math.abs(linvelX),
    linvelX,
    linvelY: 0,
    angvel: 0
  });
}

function frame(world: PhysicsWorld, states: ReadonlyMap<string, VehicleMotionState>): TimelineFrame {
  return Object.freeze({
    states: new Map(states),
    contacts: Object.freeze(world.contacts().map(({first, second}) => Object.freeze({
      firstBodyKey: first,
      secondBodyKey: second
    })))
  });
}

function snapshotAt(
  timeline: readonly TimelineFrame[],
  tick: number,
  rootKey: string
): InteractionSnapshot {
  const frame = timeline[tick];
  const root = frame.states.get(rootKey);
  if (!root) throw new Error(`Missing root state ${rootKey} at tick ${tick}.`);
  const orderedKeys = [
    rootKey,
    pairedVehicleKey(rootKey),
    ...[...frame.states.keys()].filter((key) => key !== rootKey && key !== pairedVehicleKey(rootKey))
  ];
  return Object.freeze({
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick: tick,
    baselineTick: tick,
    serverTimeMs: tick * SIMULATION_STEP_MS,
    worldCollisionRevision: 2,
    streamRevision: 1,
    surfaceRevision: 1,
    controlRevision: 1,
    rootLifecycleRevision: 1,
    rootBodyKey: rootKey,
    rootMode: 'driver',
    acknowledgedLocalInputSequence: tick,
    confirmedEventsThrough: tick,
    bodies: Object.freeze(orderedKeys.map((key) => body(key, frame.states.get(key)!))),
    intents: Object.freeze(orderedKeys.map((key) => intent(key, tick))),
    contacts: frame.contacts
  });
}

function body(key: string, state: VehicleMotionState): InteractionBodyState {
  return Object.freeze({
    key,
    actorType: 'vehicle',
    entityId: key.slice('vehicle:'.length),
    spaceId: 'street',
    surfaceId: 'street-ground',
    shapeKey: 'vehicle:sedan',
    shapeRevision: 1,
    lifecycleRevision: 1,
    priority: 'ambient',
    x: state.x,
    y: state.y,
    rotation: state.angle,
    linvelX: state.linvelX,
    linvelY: state.linvelY,
    angvel: state.angvel
  });
}

function intent(bodyKey: string, tick: number): InteractionIntentState {
  return Object.freeze({
    bodyKey,
    appliedAtServerTick: tick,
    moveX: 0,
    moveY: 0,
    steering: 0,
    throttle: 0,
    handbrake: false,
    movementScale: 1
  });
}

function pendingMoves(
  timeline: readonly TimelineFrame[],
  acknowledgedTick: number,
  currentTick: number,
  rootKey: string
): readonly VehiclePredictionPendingMove[] {
  const result: VehiclePredictionPendingMove[] = [];
  for (let tick = acknowledgedTick + 1; tick <= currentTick; tick++) {
    result.push(Object.freeze({
      message: Object.freeze({sequence: tick, x: 0, y: 0}),
      modifiers: Object.freeze({}),
      predicted: poseAt(timeline, tick, rootKey)
    }));
  }
  return Object.freeze(result);
}

function poseAt(
  timeline: readonly TimelineFrame[],
  tick: number,
  rootKey: string
): VehiclePredictionPose {
  const state = timeline[tick]?.states.get(rootKey);
  if (!state) throw new Error(`Missing pose ${rootKey} at tick ${tick}.`);
  return Object.freeze({
    vehicleId: rootKey.slice('vehicle:'.length),
    kind: 'sedan',
    surfaceId: 'street-ground',
    ...state
  });
}

function pairedVehicleKey(rootKey: string): string {
  const index = Number(rootKey.slice('vehicle:v'.length));
  return vehicleKey(index % 2 === 0 ? index + 1 : index - 1);
}

function vehicleKey(index: number): string {
  return `vehicle:v${index}`;
}

function physicsState(state: VehicleMotionState): PhysicsBodyState {
  return {
    x: state.x,
    y: state.y,
    rotation: state.angle,
    linvelX: state.linvelX,
    linvelY: state.linvelY,
    angvel: state.angvel
  };
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function emptyPhysicsGeometry() {
  return {
    width: 1,
    height: 1,
    tileWidth: 1,
    tileHeight: 1,
    collisions: Object.freeze([]),
    encloseBorders: false
  };
}

function surfaceFixture(): SurfaceManifest {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  return {
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [{
      id: 'street-ground',
      spaceId: 'street',
      actorKinds,
      triangles: [
        triangle(point(-5000, -5000), point(5000, -5000), point(5000, 5000)),
        triangle(point(-5000, -5000), point(5000, 5000), point(-5000, 5000))
      ]
    }],
    transitions: []
  };
}

function point(x: number, y: number) {
  return {x, y, z: 0};
}

function triangle(a: ReturnType<typeof point>, b: ReturnType<typeof point>, c: ReturnType<typeof point>) {
  return {a, b, c};
}

export function assertVehicleInteractionReplayActivationGate(
  result: VehicleInteractionReplaySoakResult
): void {
  if (result.acceptedSnapshots < 700) throw new Error('Too few accepted interaction snapshots.');
  if (result.rejectedSnapshots !== 0) throw new Error('Interaction snapshots were rejected.');
  if (result.activeReplays !== result.acceptedSnapshots) throw new Error('A replay failed closed.');
  if (result.maximumReplayTicks > DEFAULT_INTERACTION_HISTORY_TICKS) {
    throw new Error('Replay exceeded the retained history window.');
  }
  if (result.maximumBodies !== 5) throw new Error('Mobile weighted admission did not select five vehicles.');
  if (result.maximumWeightedPoints !== MOBILE_INTERACTION_ISLAND_BUDGET) {
    throw new Error('Mobile weighted admission did not fill its budget.');
  }
  if (result.budgetViolations !== 0) throw new Error('Interaction selection exceeded its budget.');
  if (result.overflowSelections === 0) throw new Error('The soak did not exercise conservative overflow.');
  if (result.contactSnapshots === 0) throw new Error('The soak did not exercise vehicle contacts.');
  if (result.retransmissions === 0) throw new Error('The soak did not exercise reliable retransmission delay.');
  if (result.rootErrorP95 >= 48) throw new Error(`Root p95 error was ${result.rootErrorP95}px.`);
  if (result.maximumRootError >= 180) throw new Error(`Maximum root error was ${result.maximumRootError}px.`);
  if (result.replayDurationP95Ms >= 8) {
    throw new Error(`Replay p95 was ${result.replayDurationP95Ms}ms.`);
  }
  if (result.finalConvergenceError >= 0.001) {
    throw new Error(`Final convergence error was ${result.finalConvergenceError}px.`);
  }
}

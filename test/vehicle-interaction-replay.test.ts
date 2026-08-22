import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  InteractionActorType,
  InteractionBodyState,
  InteractionSnapshot
} from '../shared/protocol/interaction-islands.ts';
import {SurfaceMap, type SurfaceManifest} from '../shared/world/surface-map.ts';
import type {InteractionIslandSelection} from '../src/game/network/interaction-island-selector.ts';
import {
  VehicleInteractionReplayController,
  type VehicleInteractionReplayInput
} from '../src/game/network/vehicle-interaction-replay.ts';
import type {VehiclePredictionPendingMove} from '../src/game/network/vehicle-prediction-controller.ts';

test('vehicle island replay advances root and remote vehicles in one deterministic Rapier world', async () => {
  const controller = await VehicleInteractionReplayController.create(new SurfaceMap(surfaceFixture()));
  try {
    const input = replayInput();
    const result = controller.evaluate(input);

    assert.equal(result.active, true);
    assert.equal(result.reason, 'replayed');
    assert.equal(result.replayTicks, 2);
    assert.equal(result.vehicleBodies, 2);
    assert.ok(result.rootPose);
    assert.ok((result.rootPose?.x ?? 0) > 0);
    assert.equal(result.rootPose?.vehicleId, 'root');

    const cached = controller.evaluate(input);
    assert.equal(cached.active, true);
    assert.equal(cached.reason, 'cached');
  } finally {
    controller.destroy();
  }
});

test('vehicle island replay fails closed for unsupported bodies and incomplete history', async () => {
  const controller = await VehicleInteractionReplayController.create(new SurfaceMap(surfaceFixture()));
  try {
    const base = replayInput();
    assert.equal(controller.evaluate({
      ...base,
      pendingMoves: undefined
    }).reason, 'input-gap');

    const mixedSnapshot = snapshot([
      vehicleBody('vehicle:root', 'root', 0, 0),
      vehicleBody('vehicle:peer', 'peer', 100, 0),
      body('player:nearby', 'player', 'nearby', 50, 20)
    ]);
    assert.equal(controller.evaluate({
      ...base,
      snapshot: mixedSnapshot,
      selection: selection(mixedSnapshot)
    }).reason, 'unsupported-body');

    const rootOnlySnapshot = snapshot([vehicleBody('vehicle:root', 'root', 0, 0)]);
    assert.equal(controller.evaluate({
      ...base,
      snapshot: rootOnlySnapshot,
      selection: selection(rootOnlySnapshot)
    }).reason, 'no-vehicle-peer');
  } finally {
    controller.destroy();
  }
});

function replayInput(): VehicleInteractionReplayInput {
  const value = snapshot([
    vehicleBody('vehicle:root', 'root', 0, 0),
    vehicleBody('vehicle:peer', 'peer', 100, 0)
  ]);
  return {
    snapshot: value,
    selection: selection(value),
    pendingMoves: [pending(1), pending(2)],
    currentLocalPose: {
      vehicleId: 'root',
      kind: 'sedan',
      surfaceId: 'street-ground',
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      linvelX: 0,
      linvelY: 0,
      angvel: 0
    }
  };
}

function pending(sequence: number): VehiclePredictionPendingMove {
  return Object.freeze({
    message: Object.freeze({sequence, x: 0, y: -1}),
    modifiers: Object.freeze({}),
    predicted: Object.freeze({
      vehicleId: 'root',
      kind: 'sedan',
      surfaceId: 'street-ground',
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      linvelX: 0,
      linvelY: 0,
      angvel: 0
    })
  });
}

function snapshot(bodies: readonly InteractionBodyState[]): InteractionSnapshot {
  return {
    protocolVersion: 7,
    serverTick: 20,
    baselineTick: 20,
    serverTimeMs: 320,
    worldCollisionRevision: 2,
    streamRevision: 1,
    surfaceRevision: 1,
    controlRevision: 1,
    rootLifecycleRevision: 1,
    rootBodyKey: 'vehicle:root',
    rootMode: 'driver',
    acknowledgedLocalInputSequence: 0,
    confirmedEventsThrough: 20,
    bodies,
    intents: [{
      bodyKey: 'vehicle:peer',
      appliedAtServerTick: 20,
      moveX: 0,
      moveY: 0,
      steering: 0,
      throttle: 0.5,
      handbrake: false,
      movementScale: 1
    }],
    contacts: []
  };
}

function selection(value: InteractionSnapshot): InteractionIslandSelection {
  const members = value.bodies.map((candidate, index) => ({
    body: candidate,
    points: candidate.actorType === 'vehicle' ? 4 : 1,
    reason: index === 0 ? 'root' as const : 'server-ranked' as const
  }));
  return {
    serverTick: value.serverTick,
    rootBodyKey: value.rootBodyKey,
    members,
    bodyKeys: members.map(({body: candidate}) => candidate.key),
    weightedPoints: members.reduce((sum, member) => sum + member.points, 0),
    budgetPoints: 32,
    overflowBodyKeys: [],
    resetCount: 0
  };
}

function vehicleBody(
  key: string,
  entityId: string,
  x: number,
  y: number
): InteractionBodyState {
  return body(key, 'vehicle', entityId, x, y, {
    shapeKey: 'vehicle:sedan',
    priority: key === 'vehicle:root' ? 'player-controlled' : 'ambient'
  });
}

function body(
  key: string,
  actorType: InteractionActorType,
  entityId: string,
  x: number,
  y: number,
  overrides: Partial<InteractionBodyState> = {}
): InteractionBodyState {
  return {
    key,
    actorType,
    entityId,
    spaceId: 'street',
    surfaceId: 'street-ground',
    shapeKey: actorType,
    shapeRevision: 1,
    lifecycleRevision: 1,
    priority: 'ambient',
    x,
    y,
    rotation: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0,
    ...overrides
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
        triangle(point(-1000, -1000), point(1000, -1000), point(1000, 1000)),
        triangle(point(-1000, -1000), point(1000, 1000), point(-1000, 1000))
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {
  InteractionSnapshotProjector
} from '../server/game/network/interaction-snapshot-projector.ts';
import type {InteractionPhysicsFrame} from '../server/game/vehicles/vehicle-simulation-controller.ts';

test('projects the controlled body, contact bodies, intents, and authoritative revisions', () => {
  const state = districtWithPlayer('local');
  const traffic = vehicle(state, 'traffic', '', 30, 0);
  const frame = physicsFrame([
    body('player:local', 'player', 'local', 0, 0, 'ground', 3, 5),
    body('vehicle:traffic', 'vehicle', traffic.id, 30, 0, 'ground', 2, 7)
  ], [
    {firstBodyKey: 'vehicle:traffic', secondBodyKey: 'player:local'},
    {firstBodyKey: 'player:local', secondBodyKey: 'vehicle:traffic'}
  ]);
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => ({tick: 41, nowMs: 2050}),
    physicsFrame: () => frame,
    worldCollisionRevision: 9,
    playerIntentFor: () => ({inputX: 1, inputY: -0.5, sequence: 12})
  });

  const snapshot = projector.project('local');

  assert.ok(snapshot);
  assert.equal(snapshot.rootBodyKey, 'player:local');
  assert.equal(snapshot.rootLifecycleRevision, 5);
  assert.deepEqual(snapshot.bodies.map(({key}) => key), ['player:local', 'vehicle:traffic']);
  assert.deepEqual(snapshot.contacts, [{
    firstBodyKey: 'player:local',
    secondBodyKey: 'vehicle:traffic'
  }]);
  assert.deepEqual(snapshot.intents[0], {
    bodyKey: 'player:local',
    appliedAtServerTick: 41,
    moveX: 1,
    moveY: -0.5,
    steering: 0,
    throttle: 0,
    handbrake: false,
    movementScale: 1
  });
  assert.equal(snapshot.bodies[0]?.shapeRevision, 3);
  assert.equal(snapshot.bodies[1]?.lifecycleRevision, 7);
});

test('admits current contacts before time-to-contact candidates within the weighted budget', () => {
  const state = districtWithPlayer('local');
  vehicle(state, 'touching', '', 200, 0);
  vehicle(state, 'approaching', '', 100, 0);
  vehicle(state, 'ambient', '', 500, 0);
  const frame = physicsFrame([
    body('player:local', 'player', 'local', 0, 0),
    body('vehicle:touching', 'vehicle', 'touching', 200, 0),
    body('vehicle:approaching', 'vehicle', 'approaching', 100, 0, 'ground', 1, 1, -200, 0),
    body('vehicle:ambient', 'vehicle', 'ambient', 500, 0)
  ], [{firstBodyKey: 'player:local', secondBodyKey: 'vehicle:touching'}]);
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => ({tick: 1, nowMs: 50}),
    physicsFrame: () => frame,
    worldCollisionRevision: 1,
    budgetPoints: 9
  });

  assert.deepEqual(projector.project('local')?.bodies.map(({key}) => key), [
    'player:local',
    'vehicle:touching',
    'vehicle:approaching'
  ]);
});

test('never mixes physics surfaces into one interaction baseline', () => {
  const state = districtWithPlayer('local');
  vehicle(state, 'ground-car', '', 20, 0);
  vehicle(state, 'bridge-car', '', 1, 0);
  const frame = physicsFrame([
    body('player:local', 'player', 'local', 0, 0),
    body('vehicle:ground-car', 'vehicle', 'ground-car', 20, 0),
    body('vehicle:bridge-car', 'vehicle', 'bridge-car', 1, 0, 'bridge')
  ], []);
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => ({tick: 1, nowMs: 50}),
    physicsFrame: () => frame,
    worldCollisionRevision: 1
  });

  assert.deepEqual(projector.project('local')?.bodies.map(({key}) => key), [
    'player:local',
    'vehicle:ground-car'
  ]);
});

test('increments control revision across root changes and retains bounded history', () => {
  const state = districtWithPlayer('local');
  const car = vehicle(state, 'car', 'local', 0, 0);
  let tick = 1;
  let frame = physicsFrame([body('player:local', 'player', 'local', 0, 0)], []);
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => ({tick, nowMs: tick * 50}),
    physicsFrame: () => frame,
    worldCollisionRevision: 1,
    historyTicks: 2
  });

  assert.equal(projector.project('local')?.controlRevision, 1);
  state.players.get('local')!.vehicleId = car.id;
  state.players.get('local')!.vehicleSeat = 0;
  frame = physicsFrame([body('vehicle:car', 'vehicle', 'car', 0, 0)], []);
  tick = 2;
  assert.equal(projector.project('local')?.controlRevision, 2);
  tick = 3;
  assert.equal(projector.project('local')?.controlRevision, 2);
  assert.deepEqual(projector.historyFor('local').map(({serverTick}) => serverTick), [2, 3]);
});

function districtWithPlayer(id: string): DistrictState {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = id;
  player.surfaceId = 'ground';
  player.lastInputSequence = 12;
  state.players.set(id, player);
  return state;
}

function vehicle(
  state: DistrictState,
  id: string,
  driverId: string,
  x: number,
  y: number
): VehicleState {
  const value = new VehicleState();
  value.id = id;
  value.driverId = driverId;
  value.x = x;
  value.y = y;
  value.surfaceId = 'ground';
  state.vehicles.set(id, value);
  return value;
}

function physicsFrame(
  bodies: InteractionPhysicsFrame['bodies'],
  contacts: InteractionPhysicsFrame['contacts']
): InteractionPhysicsFrame {
  return Object.freeze({tick: 1, bodies: Object.freeze(bodies), contacts: Object.freeze(contacts)});
}

function body(
  key: string,
  actorType: InteractionPhysicsFrame['bodies'][number]['actorType'],
  entityId: string,
  x: number,
  y: number,
  surfaceId = 'ground',
  shapeRevision = 1,
  lifecycleRevision = 1,
  linvelX = 0,
  linvelY = 0
): InteractionPhysicsFrame['bodies'][number] {
  return Object.freeze({
    key,
    actorType,
    entityId,
    surfaceId,
    shapeKey: actorType === 'vehicle' ? 'vehicle:sedan' : 'humanoid:18',
    shapeRevision,
    lifecycleRevision,
    x,
    y,
    rotation: 0,
    linvelX,
    linvelY,
    angvel: 0
  });
}

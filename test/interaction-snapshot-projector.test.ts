import assert from 'node:assert/strict';
import test from 'node:test';
import type {InteractionSnapshot} from '../shared/protocol/interaction-contracts.ts';
import {
  DistrictState,
  NpcState,
  PlayerState,
  RocketProjectileState,
  VehicleState
} from '../server/state.ts';
import {
  InteractionSnapshotProjector,
  type InteractionCandidateReference
} from '../server/game/network/interaction-snapshot-projector.ts';

test('projector freezes one complete same-tick baseline before later state mutation', () => {
  const state = new DistrictState();
  const local = player('local', 100, 200);
  local.lastInputSequence = 12;
  const remote = player('remote', 130, 200);
  const interior = player('interior', 110, 200);
  interior.spaceId = 'mercy-hospital';
  const npc = new NpcState();
  npc.id = 'npc-1';
  npc.x = 150;
  npc.y = 200;
  const vehicle = new VehicleState();
  vehicle.id = 'car-1';
  vehicle.x = 170;
  vehicle.y = 200;
  vehicle.angle = 0.5;
  vehicle.speed = 60;
  const rocket = new RocketProjectileState();
  rocket.id = 'rocket-1';
  rocket.ownerId = 'remote';
  rocket.x = 190;
  rocket.y = 200;
  state.players.set(local.id, local);
  state.players.set(remote.id, remote);
  state.players.set(interior.id, interior);
  state.npcs.set(npc.id, npc);
  state.vehicles.set(vehicle.id, vehicle);
  state.rockets.set(rocket.id, rocket);
  const clock = {tick: 100, nowMs: 10_000};
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => clock,
    worldCollisionRevision: 3,
    playerIntentFor: (playerId) => playerId === 'remote'
      ? {inputX: 1, inputY: 0, sequence: 8}
      : {inputX: 0, inputY: -1, sequence: 12},
    projectileMotionFor: () => ({velocityX: 400, velocityY: 0})
  });

  assert.equal(projector.capture(99), true);
  remote.x = 999;
  vehicle.speed = 5;
  const snapshot = projector.project('local', [
    reference('player', 'remote'),
    reference('pedestrian', 'npc-1'),
    reference('vehicle', 'car-1'),
    reference('projectile', 'rocket-1'),
    reference('player', 'interior')
  ]);

  assert.ok(snapshot);
  assert.deepEqual(snapshot.entities.map(({id}) => id), [
    'local',
    'remote',
    'rocket-1',
    'car-1',
    'npc-1'
  ]);
  assert.equal(snapshot.acknowledgedLocalInputSequence, 12);
  assert.equal(snapshot.confirmedEventsThrough, 99);
  assert.equal(entity(snapshot, 'remote').x, 130);
  assert.equal(entity(snapshot, 'remote').interactionPriority, 'player-controlled');
  assert.equal(entity(snapshot, 'car-1').kind, 'vehicle');
  assert.equal(entity(snapshot, 'car-1').interactionPriority, 'ambient');
  assert.equal(entity(snapshot, 'rocket-1').velocityX, 400);
  assert.equal(entity(snapshot, 'rocket-1').interactionPriority, 'player-controlled');
  assert.deepEqual(snapshot.remoteIntents.map(({entityId}) => entityId), ['remote']);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.entities), true);
  assert.equal(Object.isFrozen(snapshot.entities[0]), true);
  assert.equal(projector.capture(), false);
});

test('projector derives motion, retains 24 ticks, and advances lifecycle and collider revisions', () => {
  const state = new DistrictState();
  const local = player('local', 0, 0);
  state.players.set(local.id, local);
  const clock = {tick: 0, nowMs: 0};
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => clock,
    worldCollisionRevision: 1
  });

  for (let tick = 1; tick <= 30; tick++) {
    clock.tick = tick;
    clock.nowMs = tick * 100;
    local.x = tick * 10;
    assert.equal(projector.capture(), true);
    const snapshot = projector.project(local.id);
    assert.ok(snapshot);
    if (tick > 1) assert.equal(snapshot.entities[0].velocityX, 100);
  }
  assert.equal(projector.historyFor(local.id).length, 24);
  assert.equal(projector.historyFor(local.id)[0].serverTick, 7);

  state.players.delete(local.id);
  clock.tick = 31;
  clock.nowMs = 3_100;
  projector.capture();
  state.players.set(local.id, local);
  clock.tick = 32;
  clock.nowMs = 3_200;
  projector.capture();
  const returned = projector.project(local.id);
  assert.ok(returned);
  assert.equal(returned.entities[0].lifecycleRevision, 2);

  const vehicle = new VehicleState();
  vehicle.id = 'car-1';
  vehicle.driverId = local.id;
  state.vehicles.set(vehicle.id, vehicle);
  local.vehicleId = vehicle.id;
  local.vehicleSeat = 0;
  clock.tick = 33;
  clock.nowMs = 3_300;
  projector.capture();
  const sedan = projector.project(local.id);
  assert.ok(sedan);
  assert.equal(sedan.entities[0].colliderRevision, 1);
  vehicle.kind = 'police';
  clock.tick = 34;
  clock.nowMs = 3_400;
  projector.capture();
  const police = projector.project(local.id);
  assert.ok(police);
  assert.equal(police.entities[0].colliderRevision, 2);
});

test('projector publishes one root-first baseline per connected player', () => {
  const state = new DistrictState();
  state.players.set('one', player('one', 0, 0));
  state.players.set('two', player('two', 20, 0));
  const published = new Map<string, InteractionSnapshot>();
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => ({tick: 5, nowMs: 500}),
    worldCollisionRevision: 1,
    candidatesFor: () => [reference('player', 'one'), reference('player', 'two')],
    publish: (playerId, snapshot) => published.set(playerId, snapshot)
  });

  projector.capture();
  assert.equal(projector.publishCurrent(state.players.keys()), 2);
  assert.deepEqual([...published.keys()], ['one', 'two']);
  assert.equal(published.get('one')?.entities[0].id, 'one');
  assert.equal(published.get('two')?.entities[0].id, 'two');
  assert.equal(projector.snapshotAt('one', 5), published.get('one'));
  projector.clearPlayer('one');
  assert.equal(projector.historyFor('one').length, 0);
});

test('projector capacity keeps imminent contacts ahead of closer stationary ambient actors', () => {
  const state = new DistrictState();
  const local = player('local', 0, 0);
  const ambient = new NpcState();
  ambient.id = 'ambient';
  ambient.x = 100;
  const approaching = new VehicleState();
  approaching.id = 'approaching';
  approaching.x = 200;
  approaching.angle = Math.PI;
  approaching.speed = 300;
  state.players.set(local.id, local);
  state.npcs.set(ambient.id, ambient);
  state.vehicles.set(approaching.id, approaching);
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => ({tick: 1, nowMs: 100}),
    worldCollisionRevision: 1,
    maximumEntities: 2
  });

  projector.capture();
  const snapshot = projector.project(local.id, [
    reference('pedestrian', ambient.id),
    reference('vehicle', approaching.id)
  ]);
  assert.deepEqual(snapshot?.entities.map(({id}) => id), ['local', 'approaching']);
});

test('projector marks an occupied remote vehicle as player-controlled', () => {
  const state = new DistrictState();
  const local = player('local', 0, 0);
  const remote = player('remote', 100, 0);
  const vehicle = new VehicleState();
  vehicle.id = 'remote-car';
  vehicle.driverId = remote.id;
  remote.vehicleId = vehicle.id;
  remote.vehicleSeat = 0;
  state.players.set(local.id, local);
  state.players.set(remote.id, remote);
  state.vehicles.set(vehicle.id, vehicle);
  const projector = new InteractionSnapshotProjector({
    state,
    clock: () => ({tick: 1, nowMs: 100}),
    worldCollisionRevision: 1
  });

  projector.capture();
  const snapshot = projector.project(local.id, [reference('vehicle', vehicle.id)]);
  assert.equal(entity(snapshot!, vehicle.id).interactionPriority, 'player-controlled');
});

function player(id: string, x: number, y: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}

function reference(
  kind: InteractionCandidateReference['kind'],
  id: string
): InteractionCandidateReference {
  return {kind, id};
}

function entity(snapshot: InteractionSnapshot, id: string) {
  const value = snapshot.entities.find((candidate) => candidate.id === id);
  assert.ok(value);
  return value;
}

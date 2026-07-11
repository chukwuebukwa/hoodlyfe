import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldReplicateStreetEntity,
  STREET_STREAMING
} from '../server/game/replication/street-streaming-policy.ts';
import {DistrictReplicationController} from '../server/game/replication/district-replication-controller.ts';
import {
  DistrictState,
  MissionParticipantState,
  MissionState,
  NpcState,
  PlayerState,
  VehicleState
} from '../server/state.ts';

test('street streaming policy uses a stable enter/exit hysteresis band', () => {
  assert.equal(shouldReplicateStreetEntity({
    distance: STREET_STREAMING.enterRadius,
    visible: false
  }), true);
  assert.equal(shouldReplicateStreetEntity({
    distance: STREET_STREAMING.enterRadius + 1,
    visible: false
  }), false);
  assert.equal(shouldReplicateStreetEntity({
    distance: STREET_STREAMING.exitRadius,
    visible: true
  }), true);
  assert.equal(shouldReplicateStreetEntity({
    distance: STREET_STREAMING.exitRadius + 1,
    visible: true
  }), false);
  assert.equal(shouldReplicateStreetEntity({
    distance: Number.POSITIVE_INFINITY,
    visible: false,
    alwaysRelevant: true
  }), true);
});

test('district views stream actors by distance while pinning occupied and mission vehicles', () => {
  const state = new DistrictState();
  const local = player('local', 0, 0);
  const remote = player('remote', 3_500, 3_500);
  state.players.set(local.id, local);
  state.players.set(remote.id, remote);

  const near = npc('near', STREET_STREAMING.enterRadius - 1, 0);
  const band = npc('band', STREET_STREAMING.enterRadius + 100, 0);
  const far = npc('far', STREET_STREAMING.exitRadius + 500, 0);
  state.npcs.set(near.id, near);
  state.npcs.set(band.id, band);
  state.npcs.set(far.id, far);

  const occupied = vehicle('occupied', 3_400, 3_400);
  occupied.driverId = remote.id;
  remote.vehicleId = occupied.id;
  const target = vehicle('mission-target', 3_000, 0);
  state.vehicles.set(occupied.id, occupied);
  state.vehicles.set(target.id, target);
  const mission = new MissionState();
  mission.id = 'job';
  mission.targetVehicleId = target.id;
  const participant = new MissionParticipantState();
  participant.playerId = local.id;
  mission.participants.set(local.id, participant);
  state.missions.set(mission.id, mission);

  const controller = new DistrictReplicationController(state);
  const view = controller.attach(local.id);
  assert.equal(view.has(local), true);
  assert.equal(view.has(remote), true, 'Online players remain globally relevant for player blips.');
  assert.equal(view.has(near), true);
  assert.equal(view.has(band), false);
  assert.equal(view.has(far), false);
  assert.equal(view.has(occupied), true);
  assert.equal(view.has(target), true);

  band.x = STREET_STREAMING.enterRadius - 1;
  controller.synchronize();
  assert.equal(view.has(band), true);
  band.x = STREET_STREAMING.exitRadius - 1;
  controller.synchronize();
  assert.equal(view.has(band), true, 'A visible actor remains through the hysteresis band.');
  band.x = STREET_STREAMING.exitRadius + 1;
  controller.synchronize();
  assert.equal(view.has(band), false);
});

test('replication budgets prioritize deterministic additions across patches', () => {
  const state = new DistrictState();
  const local = player('local', 0, 0);
  state.players.set(local.id, local);
  for (let index = 0; index < 5; index++) {
    const value = npc(`npc-${index}`, 50 + index * 10, 0);
    state.npcs.set(value.id, value);
  }
  const controller = new DistrictReplicationController(state, {
    maxAddsPerPatch: 2,
    maxRemovesPerPatch: 2
  });
  const view = controller.attach(local.id);
  assert.equal(controller.diagnostics()[0].visible, 2);
  assert.ok(controller.diagnostics()[0].pendingAdds > 0);
  controller.synchronize();
  assert.equal(controller.diagnostics()[0].visible, 4);
  controller.synchronize();
  controller.synchronize();
  assert.equal(controller.diagnostics()[0].visible, 6);
  assert.equal(controller.diagnostics()[0].pendingAdds, 0);
  assert.equal(view.has(state.npcs.get('npc-0')!), true);
});

function player(id: string, x: number, y: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}

function npc(id: string, x: number, y: number): NpcState {
  const value = new NpcState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}

function vehicle(id: string, x: number, y: number): VehicleState {
  const value = new VehicleState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}

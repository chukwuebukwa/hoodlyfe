import assert from 'node:assert/strict';
import test from 'node:test';
import {Encoder} from '@colyseus/schema';
import {DistrictReplicationController} from '../server/game/replication/district-replication-controller.ts';
import {
  DistrictState,
  NpcState,
  PlayerState,
  StreetServiceState,
  VehicleState
} from '../server/state.ts';

test('district replication exposes complete street state and exact same-space interiors', () => {
  const state = new DistrictState();
  const streetPlayer = player('street-player', 'street');
  const otherStreetPlayer = player('street-peer', 'street');
  const interiorPlayer = player('interior-player', 'threads-showroom');
  state.players.set(streetPlayer.id, streetPlayer);
  state.players.set(otherStreetPlayer.id, otherStreetPlayer);
  state.players.set(interiorPlayer.id, interiorPlayer);

  const npc = new NpcState();
  npc.id = 'civilian';
  state.npcs.set(npc.id, npc);
  const vehicle = new VehicleState();
  vehicle.id = 'sedan';
  state.vehicles.set(vehicle.id, vehicle);
  const streetService = service('ammunition', 'street');
  const interiorService = service('threads', 'threads-showroom');
  state.services.set(streetService.id, streetService);
  state.services.set(interiorService.id, interiorService);

  const controller = new DistrictReplicationController(state);
  const streetView = controller.attach(streetPlayer.id);
  const interiorView = controller.attach(interiorPlayer.id);

  assert.equal(streetView.has(streetPlayer), true);
  assert.equal(streetView.has(otherStreetPlayer), true);
  assert.equal(streetView.has(interiorPlayer), false);
  assert.equal(streetView.has(npc), true);
  assert.equal(streetView.has(vehicle), true);
  assert.equal(streetView.has(streetService), true);
  assert.equal(streetView.has(interiorService), false);

  assert.equal(interiorView.has(interiorPlayer), true);
  assert.equal(interiorView.has(streetPlayer), false);
  assert.equal(interiorView.has(npc), false);
  assert.equal(interiorView.has(vehicle), false);
  assert.equal(interiorView.has(streetService), false);
  assert.equal(interiorView.has(interiorService), true);
});

test('district replication diffs a space transition and newly attached state', () => {
  const state = new DistrictState();
  const local = player('local', 'street');
  const peer = player('peer', 'street');
  state.players.set(local.id, local);
  state.players.set(peer.id, peer);
  const controller = new DistrictReplicationController(state);
  const view = controller.attach(local.id);

  const lateVehicle = new VehicleState();
  lateVehicle.id = 'late-vehicle';
  state.vehicles.set(lateVehicle.id, lateVehicle);
  controller.synchronize();
  assert.equal(view.has(lateVehicle), true);

  state.players.delete(peer.id);
  controller.synchronize();
  assert.equal(view.has(peer), false);
  state.players.set(peer.id, peer);
  controller.synchronize();
  assert.equal(view.has(peer), true);

  local.spaceId = 'threads-showroom';
  controller.synchronize();
  assert.equal(view.has(local), true);
  assert.equal(view.has(peer), false);
  assert.equal(view.has(lateVehicle), false);

  local.spaceId = 'street';
  controller.synchronize();
  assert.equal(view.has(peer), true);
  assert.equal(view.has(lateVehicle), true);
});

test('district replication queues a complete snapshot after a newly attached schema is encoded', () => {
  const state = new DistrictState();
  const local = player('local', 'street');
  state.players.set(local.id, local);
  const controller = new DistrictReplicationController(state);
  const view = controller.attach(local.id);
  const encoder = new Encoder(state);

  const peer = player('peer', 'street');
  peer.armor = 25;
  state.players.set(peer.id, peer);
  controller.synchronize();
  assert.equal(view.has(peer), true);

  encoder.encodeView(view, 0, {offset: 0});
  encoder.discardChanges();
  controller.synchronize();

  assert.ok(view.changes.size > 0);
  assert.ok([...view.changes.values()].some((changes) => Object.keys(changes).length > 0));

  state.players.delete(peer.id);
  controller.synchronize();
  assert.equal(view.has(peer), false);
});

function player(id: string, spaceId: string): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.spaceId = spaceId;
  return value;
}

function service(id: string, spaceId: string): StreetServiceState {
  const value = new StreetServiceState();
  value.id = id;
  value.spaceId = spaceId;
  return value;
}

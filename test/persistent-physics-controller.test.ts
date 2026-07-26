import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {
  DistrictState,
  NpcState,
  PlayerState,
  VehicleState
} from '../server/state.ts';
import {physicsBodyKey} from '../shared/simulation/humanoid-body-drive.ts';
import {VEHICLE_SIMULATION_STEP_SECONDS} from '../shared/simulation/vehicle-step.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';
import type {PhysicsLifecycleOperations} from '../server/game/vehicles/physics-body-registry.ts';

test('controller reconciles actor eligibility while ordinary ticks retain body identity', () => {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true, surfaceAfterMove: (surfaceId: string) => surfaceId};
  room.setState(new DistrictState());
  const vehicle = actorVehicle();
  const player = actorPlayer();
  const npc = actorNpc();
  room.state.vehicles.set(vehicle.id, vehicle);
  room.state.players.set(player.id, player);
  room.state.npcs.set(npc.id, npc);
  const controller = attachTestVehicleSimulation(room);

  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({created: 3}));
  const identities = new Map([
    ['vehicle', controller.physicsBodyIdentity(physicsBodyKey('vehicle', vehicle.id))],
    ['player', controller.physicsBodyIdentity(physicsBodyKey('player', player.id))],
    ['npc', controller.physicsBodyIdentity(physicsBodyKey('pedestrian', npc.id))]
  ]);

  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations());
  assert.equal(controller.physicsBodyIdentity(physicsBodyKey('vehicle', vehicle.id)), identities.get('vehicle'));
  assert.equal(controller.physicsBodyIdentity(physicsBodyKey('player', player.id)), identities.get('player'));
  assert.equal(controller.physicsBodyIdentity(physicsBodyKey('pedestrian', npc.id)), identities.get('npc'));

  controller.beginTick();
  player.x += 8;
  npc.y += 6;
  controller.stepPhysics(VEHICLE_SIMULATION_STEP_SECONDS, 1_000);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations());
  assert.equal(controller.physicsBodyIdentity(physicsBodyKey('player', player.id)), identities.get('player'));
  assert.equal(controller.physicsBodyIdentity(physicsBodyKey('pedestrian', npc.id)), identities.get('npc'));

  player.vehicleId = vehicle.id;
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({removed: 1}));
  player.vehicleId = '';
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({created: 1}));

  player.spaceId = 'hospital';
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({removed: 1}));
  player.spaceId = 'street';
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({created: 1}));

  player.alive = false;
  npc.alive = false;
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({removed: 2}));
  player.alive = true;
  npc.alive = true;
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({created: 2}));

  player.surfaceId = 'bridge-deck';
  npc.surfaceId = 'bridge-deck';
  vehicle.surfaceId = 'bridge-deck';
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({migrated: 3}));

  vehicle.kind = 'taxi';
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({replaced: 1}));

  room.state.vehicles.delete(vehicle.id);
  room.state.players.delete(player.id);
  room.state.npcs.delete(npc.id);
  step(controller);
  assert.deepEqual(controller.physicsDiagnostics().lifecycle.tick, operations({removed: 3}));
  assert.equal(controller.physicsDiagnostics().bodies, 0);
  controller.disposePhysics();
  room.physicsWorld.free();
});


function step(controller: ReturnType<typeof attachTestVehicleSimulation>): void {
  controller.beginTick();
  controller.stepPhysics(VEHICLE_SIMULATION_STEP_SECONDS, 1_000);
}

function actorVehicle(): VehicleState {
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.kind = 'sedan';
  vehicle.x = 1000;
  vehicle.y = 1000;
  vehicle.surfaceId = 'street-ground';
  return vehicle;
}

function actorPlayer(): PlayerState {
  const player = new PlayerState();
  player.id = 'player';
  player.x = 1500;
  player.y = 1500;
  player.surfaceId = 'street-ground';
  player.spaceId = 'street';
  return player;
}

function actorNpc(): NpcState {
  const npc = new NpcState();
  npc.id = 'npc';
  npc.x = 2000;
  npc.y = 2000;
  npc.surfaceId = 'street-ground';
  return npc;
}

function operations(overrides: Partial<PhysicsLifecycleOperations> = {}): PhysicsLifecycleOperations {
  return {created: 0, removed: 0, migrated: 0, replaced: 0, teleported: 0, ...overrides};
}

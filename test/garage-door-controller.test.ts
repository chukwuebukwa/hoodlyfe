import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {SEAMLESS_GARAGE_DOORS} from '../shared/content/seamless-interior-catalog.ts';
import {garageDoorProgress} from '../shared/content/garage-door.ts';
import {
  GARAGE_DOOR_PASSABLE_PROGRESS,
  GarageDoorController
} from '../server/game/world/garage-door-controller.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {setGarageDoorProgress} from '../src/game/presentation/seamless-interiors.ts';

test('garage door opens by proximity, holds, reverses for obstruction, and closes', () => {
  const door = SEAMLESS_GARAGE_DOORS.find(({id}) => id === 'westside-auto-garage');
  assert.ok(door);
  const state = new DistrictState();
  const world = CollisionMap.load();
  const floorSurfaceId = world.surfaces.surfaceIdsAt(door.x - 48, door.y, 'player')
    .find((surfaceId) => world.surfaces.heightAt(surfaceId, door.x - 48, door.y) === 128);
  assert.ok(floorSurfaceId);
  const physicsChanges: Array<{id: string; enabled: boolean}> = [];
  const controller = new GarageDoorController({
    state,
    world,
    physics: {
      setControlledStaticEnabled: (id, enabled) => physicsChanges.push({id, enabled})
    }
  });
  controller.initialize(0);
  assert.equal(state.garageDoors.size, 2);
  assert.equal(world.canOccupy(door.x, door.y, 11, floorSurfaceId, 'player'), false);

  const player = new PlayerState();
  player.id = 'driver';
  player.x = door.x;
  player.y = door.y;
  state.players.set(player.id, player);
  controller.update(0);
  const runtime = state.garageDoors.get(door.id);
  assert.ok(runtime);
  assert.equal(runtime.phase, 'opening');

  const passableAt = Math.ceil(door.animationMs * GARAGE_DOOR_PASSABLE_PROGRESS);
  controller.update(passableAt - 1);
  assert.equal(world.canOccupy(door.x, door.y, 11, floorSurfaceId, 'player'), false);
  controller.update(passableAt);
  assert.equal(world.canOccupy(door.x, door.y, 11, floorSurfaceId, 'player'), true);
  controller.update(door.animationMs);
  assert.equal(runtime.phase, 'open');

  player.x = 0;
  player.y = 0;
  controller.update(door.animationMs + door.holdOpenMs);
  assert.equal(runtime.phase, 'closing');

  const obstruction = new VehicleState();
  obstruction.id = 'parked-car';
  obstruction.x = door.x;
  obstruction.y = door.y;
  state.vehicles.set(obstruction.id, obstruction);
  controller.update(door.animationMs + door.holdOpenMs + 100);
  assert.equal(runtime.phase, 'opening');

  state.vehicles.delete(obstruction.id);
  controller.update(door.animationMs * 2 + door.holdOpenMs + 100);
  assert.equal(runtime.phase, 'open');
  controller.update(door.animationMs * 2 + door.holdOpenMs * 2 + 100);
  assert.equal(runtime.phase, 'closing');
  controller.update(door.animationMs * 3 + door.holdOpenMs * 2 + 100);
  assert.equal(runtime.phase, 'closed');
  assert.equal(world.canOccupy(door.x, door.y, 11, floorSurfaceId, 'player'), false);
  assert.ok(physicsChanges.some(({id, enabled}) => id === door.id && enabled === false));
  assert.ok(physicsChanges.some(({id, enabled}) => id === door.id && enabled === true));
});

test('garage door timeline and overhead projection agree at transition endpoints', () => {
  const door = SEAMLESS_GARAGE_DOORS.find(({id}) => id === 'westside-auto-garage');
  assert.ok(door);
  const timeline = {
    phase: 'opening' as const,
    phaseStartedAt: 100,
    transitionFrom: 0,
    progress: 0
  };
  assert.equal(garageDoorProgress(timeline, door.animationMs, 100), 0);
  assert.equal(garageDoorProgress(timeline, door.animationMs, 800), 1);

  const assembly = new THREE.Group();
  const curtain = new THREE.Group();
  curtain.name = 'garage-door-curtain';
  assembly.add(curtain);
  setGarageDoorProgress(assembly, door, 0);
  assert.equal(curtain.scale.x, 0.12);
  setGarageDoorProgress(assembly, door, 1);
  assert.equal(curtain.scale.x, 1);
  assert.equal(assembly.userData.progress, 1);
});

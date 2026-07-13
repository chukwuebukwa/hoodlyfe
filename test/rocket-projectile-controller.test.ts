import assert from 'node:assert/strict';
import test from 'node:test';
import {RocketProjectileController} from '../server/game/combat/rocket-projectile-controller.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('rockets sweep into actors, preserve ownership, and detonate exactly once', () => {
  const state = new DistrictState();
  const target = new NpcState();
  target.id = 'target';
  target.x = 65;
  state.npcs.set(target.id, target);
  const detonations: Array<{x: number; y: number; ownerId: string}> = [];
  const controller = createController(state, {
    npcs: () => [target],
    detonate: (x, y, ownerId) => detonations.push({x, y, ownerId})
  });

  assert.equal(controller.launch({ownerId: 'driver', x: 0, y: 0, angle: 0, nowMs: 1000}), true);
  const rocket = [...state.rockets.values()][0];
  controller.update(rocket, rocket.id, 0.1, 1100);
  controller.update(rocket, rocket.id, 0.1, 1101);

  assert.equal(detonations.length, 1);
  assert.equal(detonations[0].ownerId, 'driver');
  assert.ok(detonations[0].x < target.x);
  assert.equal(state.rockets.size, 0);
});

test('rockets use stepped world collision and expire into an explosion', () => {
  const state = new DistrictState();
  const detonations: Array<{x: number; nowMs: number}> = [];
  const controller = createController(state, {
    blocked: (x) => x >= 50,
    detonate: (x, _y, _ownerId, nowMs) => detonations.push({x, nowMs})
  });
  controller.launch({ownerId: 'driver', x: 0, y: 0, angle: 0, nowMs: 0});
  const blocked = [...state.rockets.values()][0];
  controller.update(blocked, blocked.id, 0.1, 100);
  assert.equal(detonations.length, 1);
  assert.ok(detonations[0].x >= 50 && detonations[0].x < 57);

  const open = createController(state, {
    detonate: (x, _y, _ownerId, nowMs) => detonations.push({x, nowMs})
  });
  open.launch({ownerId: 'other', x: 0, y: 0, angle: 0, nowMs: 1000});
  const expired = [...state.rockets.values()][0];
  open.update(expired, expired.id, 0, 2400);
  assert.equal(detonations.at(-1)?.nowMs, 2400);
});

test('rockets enforce per-owner capacity and collide with players and vehicles', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'target-player';
  player.x = 80;
  const vehicle = new VehicleState();
  vehicle.id = 'target-car';
  vehicle.x = 130;
  const detonations: number[] = [];
  const controller = createController(state, {
    players: () => [player],
    vehicles: () => [vehicle],
    detonate: (x) => detonations.push(x)
  });
  assert.equal(controller.launch({ownerId: 'driver', x: 0, y: 0, angle: 0, nowMs: 0}), true);
  assert.equal(controller.launch({ownerId: 'driver', x: 0, y: 20, angle: 0, nowMs: 0}), true);
  assert.equal(controller.launch({ownerId: 'driver', x: 0, y: 40, angle: 0, nowMs: 0}), false);
  const first = [...state.rockets.values()][0];
  controller.update(first, first.id, 0.1, 100);
  controller.update(first, first.id, 0.1, 200);
  assert.equal(detonations.length, 1);
  assert.ok(detonations[0] < vehicle.x, 'The nearer player wins the swept collision.');
});

function createController(
  state: DistrictState,
  options: {
    blocked?: (x: number, y: number) => boolean;
    players?: () => PlayerState[];
    npcs?: () => NpcState[];
    vehicles?: () => VehicleState[];
    detonate: (x: number, y: number, ownerId: string, nowMs: number) => void;
  }
): RocketProjectileController {
  let controller: RocketProjectileController;
  controller = new RocketProjectileController({
    state,
    world: {isBlockedAt: options.blocked ?? (() => false)} as unknown as CollisionMap,
    queryPlayers: options.players ?? (() => []),
    queryNpcs: options.npcs ?? (() => []),
    queryVehicles: options.vehicles ?? (() => []),
    detonate: options.detonate,
    remove: (id) => {
      state.rockets.delete(id);
    }
  });
  return controller;
}

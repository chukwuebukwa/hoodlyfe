import assert from 'node:assert/strict';
import test from 'node:test';
import {ThrownProjectileController} from '../server/game/combat/thrown-projectile-controller.ts';
import {DistrictState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('thrown grenades enforce owner capacity, simulate a fuse, and detonate exactly once', () => {
  const state = new DistrictState();
  const detonations: Array<{kind: string; x: number; y: number; ownerId: string; nowMs: number}> = [];
  const controller = new ThrownProjectileController({
    state,
    world: {canOccupy: () => true} as unknown as CollisionMap,
    resolve: (kind, x, y, ownerId, nowMs) => detonations.push({kind, x, y, ownerId, nowMs}),
    remove: (projectileId) => state.thrownProjectiles.delete(projectileId)
  });

  assert.equal(controller.throw({kind: 'grenade', ownerId: 'driver', x: 0, y: 0, angle: 0, nowMs: 1000}), true);
  assert.equal(controller.throw({kind: 'grenade', ownerId: 'driver', x: 0, y: 0, angle: 0, nowMs: 1000}), true);
  assert.equal(controller.throw({kind: 'grenade', ownerId: 'driver', x: 0, y: 0, angle: 0, nowMs: 1000}), false);
  const projectile = [...state.thrownProjectiles.values()][0];
  controller.update(projectile, projectile.id, 0.1, 2999);
  assert.equal(detonations.length, 0);
  controller.update(projectile, projectile.id, 0.1, 3000);
  controller.update(projectile, projectile.id, 0.1, 3100);
  assert.equal(detonations.length, 1);
  assert.equal(detonations[0].kind, 'grenade');
  assert.equal(detonations[0].ownerId, 'driver');
  assert.equal(state.thrownProjectiles.has(projectile.id), false);
});

test('thrown grenades bounce off blocked axes without moving through the world', () => {
  const state = new DistrictState();
  const controller = new ThrownProjectileController({
    state,
    world: {canOccupy: () => false} as unknown as CollisionMap,
    resolve: () => undefined,
    remove: (projectileId) => state.thrownProjectiles.delete(projectileId)
  });
  controller.throw({kind: 'grenade', ownerId: 'driver', x: 10, y: 20, angle: 0, nowMs: 0});
  const projectile = [...state.thrownProjectiles.values()][0];
  const start = {x: projectile.x, y: projectile.y};
  controller.update(projectile, projectile.id, 0.1, 100);
  assert.deepEqual({x: projectile.x, y: projectile.y}, start);
  assert.ok(Math.abs(Math.abs(projectile.angle) - Math.PI) < 0.0001);
});

test('molotovs shatter on world impact instead of bouncing', () => {
  const state = new DistrictState();
  const resolutions: string[] = [];
  const controller = new ThrownProjectileController({
    state,
    world: {canOccupy: () => false} as unknown as CollisionMap,
    resolve: (kind) => resolutions.push(kind),
    remove: (projectileId) => state.thrownProjectiles.delete(projectileId)
  });
  controller.throw({kind: 'molotov', ownerId: 'driver', x: 10, y: 20, angle: 0, nowMs: 0});
  const projectile = [...state.thrownProjectiles.values()][0];
  controller.update(projectile, projectile.id, 0.1, 100);
  assert.deepEqual(resolutions, ['molotov']);
  assert.equal(state.thrownProjectiles.size, 0);
});

import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {CollisionMap} from '../server/world-map.ts';

const hasLocalAssets = existsSync(resolve('public/assets/maps/district-map.json'));

test('generated district exposes a safe spawn and collision boundary', {skip: !hasLocalAssets}, () => {
  const world = CollisionMap.load();
  const playerSpawn = world.spawnFor(0, 11);
  assert.equal(world.canOccupy(playerSpawn.x, playerSpawn.y, 11, playerSpawn.surfaceId), true);
  assert.equal(world.isBlockedAt(-1, -1), true);
  assert.equal(world.hasLineOfSight(world.spawn.x, world.spawn.y, world.spawn.x, world.spawn.y), true);

  const nearby = world.openPointNear(world.spawn.x, world.spawn.y, 80, 320, 11, 42);
  assert.equal(world.canOccupy(nearby.x, nearby.y, 11, nearby.surfaceId), true);

  const traffic = world.trafficSpawn(12, 20);
  assert.equal(world.isRoadAt(traffic.x, traffic.y), true);
  assert.equal(world.canOccupy(traffic.x, traffic.y, 20, traffic.surfaceId, 'vehicle'), true);
  assert.ok(world.roadNeighbors(traffic.column, traffic.row).length > 0);
  const nearestRoad = world.nearestRoadNode(world.spawn.x, world.spawn.y, 20);
  assert.ok(nearestRoad);
  const nearestRoadPoint = world.roadPoint(nearestRoad);
  assert.equal(world.isRoadAt(nearestRoadPoint.x, nearestRoadPoint.y), true);
  assert.ok(world.surfaces.surfaceIdsAt(nearestRoadPoint.x, nearestRoadPoint.y, 'vehicle').length > 0);

  for (const row of [36, 40, 44, 48]) {
    assert.ok(world.surfaces.surfaceIdsAt(
      27.5 * world.tileWidth,
      (row + 0.5) * world.tileHeight,
      'player'
    ).length > 0);
  }
});

test('traffic spawns normalize fractional and non-finite deterministic seeds', {skip: !hasLocalAssets}, () => {
  const world = CollisionMap.load();
  for (const seed of [123.75, Number.NaN, Number.POSITIVE_INFINITY]) {
    const spawn = world.trafficSpawn(seed, 20);
    assert.equal(Number.isFinite(spawn.x), true);
    assert.equal(Number.isFinite(spawn.y), true);
    assert.equal(world.canOccupy(spawn.x, spawn.y, 20, spawn.surfaceId, 'vehicle'), true);
    assert.equal(world.isRoadAt(spawn.x, spawn.y), true);
  }
});

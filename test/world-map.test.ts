import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {CollisionMap} from '../server/world-map.ts';

const hasLocalAssets = existsSync(resolve('public/assets/maps/district-map.json'));

test('generated district exposes a safe spawn and collision boundary', {skip: !hasLocalAssets}, () => {
  const world = CollisionMap.load();
  assert.equal(world.canOccupy(world.spawn.x, world.spawn.y, 11), true);
  assert.equal(world.isBlockedAt(-1, -1), true);
  assert.equal(world.hasLineOfSight(world.spawn.x, world.spawn.y, world.spawn.x, world.spawn.y), true);

  const nearby = world.openPointNear(world.spawn.x, world.spawn.y, 80, 320, 11, 42);
  assert.equal(world.canOccupy(nearby.x, nearby.y, 11), true);

  const traffic = world.trafficSpawn(12, 20);
  assert.equal(world.isRoadAt(traffic.x, traffic.y), true);
  assert.equal(world.canOccupy(traffic.x, traffic.y, 20), true);
  assert.ok(world.roadNeighbors(traffic.column, traffic.row).length > 0);

  for (const row of [36, 40, 44, 48]) {
    assert.equal(world.canOccupy(27.5 * world.tileWidth, (row + 0.5) * world.tileHeight, 11), true);
  }
});

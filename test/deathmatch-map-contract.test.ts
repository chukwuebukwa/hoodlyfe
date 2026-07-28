import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {DistrictDeathmatchRoom} from '../server/district-room.ts';
import {CollisionMap} from '../server/world-map.ts';
import {FOUNDRY_YARD_DEATHMATCH} from '../shared/content/arena-deathmatch.ts';

const mapsDirectory = new URL(
  '../public/assets/districts/deathmatch/maps/',
  import.meta.url
).pathname;

test('foundry yard spawns are open and distributed around the arena', () => {
  const world = CollisionMap.loadFromMapsDirectory(mapsDirectory);
  for (const pose of FOUNDRY_YARD_DEATHMATCH.spawns) {
    assert.equal(
      world.canOccupy(pose.x, pose.y, 14, undefined, 'player'),
      true,
      `spawn ${pose.x}:${pose.y} must be walkable`
    );
  }
  assert.equal(world.isBlockedAt(24 * 40 + 20, 24 * 40 + 20), true);
  assert.equal(new Set(FOUNDRY_YARD_DEATHMATCH.spawns.map(({x, y}) => `${x}:${y}`)).size, 8);
});

test('foundry yard is compact, bounded, and traffic-free', () => {
  const map = JSON.parse(
    readFileSync(`${mapsDirectory}/district-map.json`, 'utf8')
  ) as {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: Array<{name: string; data: number[]}>;
  };
  const roads = map.layers.find((layer) => layer.name === 'roads')?.data ?? [];
  const collisions = map.layers.find((layer) => layer.name === 'collisions')?.data ?? [];
  assert.equal(map.width, 48);
  assert.equal(map.height, 48);
  assert.equal(map.tilewidth, 40);
  assert.equal(map.tileheight, 40);
  assert.equal(roads.filter(Boolean).length, 0);
  assert.ok(collisions.filter((value) => value === 0).length > 1_400);
  assert.ok(collisions.filter(Boolean).length > 500);
  assert.equal(existsSync(`${mapsDirectory}/district-lanes.json`), false);
});

test('deathmatch room starts with match state and no ambient population', async () => {
  const room = new DistrictDeathmatchRoom();
  await room.onCreate({seed: 1, epochMs: 1_000, externalSimulation: true});
  try {
    (room as any).completeSimulationTick(1_000);
    assert.equal(room.state.deathmatch.arenaId, 'foundry-yard');
    assert.equal((room as any).laneGraph, undefined);
    assert.equal(room.state.npcs.size, 0);
    assert.equal(room.state.vehicles.size, 0);
  } finally {
    room.onDispose();
  }
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {CollisionMap} from '../server/world-map.ts';
import {INDUSTRIAL_ARENA_CIRCUIT} from '../shared/content/arena-race.ts';

const mapsDirectory = new URL(
  '../public/assets/districts/raceway/maps/',
  import.meta.url
).pathname;

test('raceway grid and checkpoints are authored on the closed course', () => {
  const world = CollisionMap.loadFromMapsDirectory(mapsDirectory);
  for (const pose of INDUSTRIAL_ARENA_CIRCUIT.grid) {
    assert.equal(
      world.canOccupy(pose.x, pose.y, 28, undefined, 'vehicle'),
      true,
      `grid pose ${pose.x}:${pose.y} must be drivable`
    );
  }
  for (const checkpoint of INDUSTRIAL_ARENA_CIRCUIT.checkpoints) {
    assert.equal(
      world.canOccupy(checkpoint.x, checkpoint.y, 28, undefined, 'vehicle'),
      true,
      `checkpoint ${checkpoint.id} must be drivable`
    );
  }
});

test('raceway contains only circuit road cells and no authored population', () => {
  const map = JSON.parse(
    readFileSync(`${mapsDirectory}/district-map.json`, 'utf8')
  ) as {
    width: number;
    height: number;
    layers: Array<{name: string; data: number[]}>;
  };
  const roads = map.layers.find((layer) => layer.name === 'roads')?.data ?? [];
  const collisions = map.layers.find((layer) => layer.name === 'collisions')?.data ?? [];
  assert.equal(roads.length, map.width * map.height);
  assert.equal(collisions.length, roads.length);
  assert.ok(roads.filter(Boolean).length > 650, 'compact course must have meaningful racing width');
  assert.ok(roads.filter(Boolean).length < roads.length * 0.5, 'course must remain a closed circuit');
  assert.ok(roads.every((road, index) => Boolean(road) === (collisions[index] === 0)));

  const lanes = JSON.parse(
    readFileSync(`${mapsDirectory}/district-lanes.json`, 'utf8')
  ) as {corridors: Array<{direction: string; trafficDensity: number}>};
  assert.ok(lanes.corridors.length >= 12);
  assert.ok(lanes.corridors.every((corridor) => (
    corridor.direction === 'forward' && corridor.trafficDensity === 0
  )));
});

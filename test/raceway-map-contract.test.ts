import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {DistrictRaceRoom} from '../server/district-room.ts';
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
    tilewidth: number;
    tileheight: number;
    layers: Array<{name: string; data: number[]}>;
  };
  const roads = map.layers.find((layer) => layer.name === 'roads')?.data ?? [];
  const collisions = map.layers.find((layer) => layer.name === 'collisions')?.data ?? [];
  assert.equal(map.width, 72);
  assert.equal(map.height, 72);
  assert.equal(map.tilewidth, 40);
  assert.equal(map.tileheight, 40);
  assert.equal(roads.length, map.width * map.height);
  assert.equal(collisions.length, roads.length);
  assert.ok(roads.filter(Boolean).length > 1_500, 'course must have meaningful racing width');
  assert.ok(roads.filter(Boolean).length < roads.length * 0.5, 'course must remain a closed circuit');
  assert.ok(roads.every((road, index) => Boolean(road) === (collisions[index] === 0)));

  assert.equal(
    existsSync(`${mapsDirectory}/district-lanes.json`),
    false,
    'traffic-free race districts must not ship lane topology'
  );
});

test('race room starts without traffic topology', async () => {
  const room = new DistrictRaceRoom();
  await room.onCreate({
    seed: 1,
    epochMs: 1_000,
    externalSimulation: true
  });
  try {
    (room as any).completeSimulationTick(1_000);
    assert.equal((room as any).laneGraph, undefined);
    assert.equal((room as any).trafficController.laneGraph(), undefined);
    assert.equal(room.state.npcs.size, 0);
    assert.equal(room.state.vehicles.size, 0);
    const population = (room as any).populationStreaming.diagnostics();
    assert.equal(population.potentialPedestrians, 0);
    assert.equal(population.activePedestrians, 0);
    assert.equal(population.potentialTraffic, 0);
    assert.equal(population.activeTraffic, 0);
    assert.equal(population.dormantActors, 0);
  } finally {
    room.onDispose();
  }
});

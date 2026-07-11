import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PopulationStreamingController,
  STREAMED_CIVILIAN_RECORDS,
  STREAMED_POLICE_RECORDS,
  STREAMED_TRAFFIC_RECORDS
} from '../server/game/population/population-streaming-controller.ts';
import {NpcState, DistrictState} from '../server/state.ts';
import type {CollisionMap, RoadNode, TrafficSpawn} from '../server/world-map.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';

test('population streaming materializes a bounded nearby subset and virtualizes it when far', () => {
  const fixture = createFixture();
  fixture.controller.initialize(0);
  assert.deepEqual(fixture.controller.diagnostics(), {
    potentialPedestrians: STREAMED_CIVILIAN_RECORDS + STREAMED_POLICE_RECORDS,
    activePedestrians: 0,
    potentialTraffic: STREAMED_TRAFFIC_RECORDS,
    activeTraffic: 0,
    pinnedPedestrians: 0,
    pinnedTraffic: 0
  });

  fixture.controller.update([{x: 0, y: 0}], 100);
  assert.equal(fixture.state.npcs.size, 5);
  assert.equal(fixture.state.vehicles.size, 5);
  assert.equal(fixture.registered.length, 5);
  assert.equal(fixture.controller.diagnostics().activePedestrians, 5);
  assert.equal(fixture.controller.diagnostics().activeTraffic, 5);

  fixture.controller.update([{x: 10_000, y: 10_000}], 200);
  assert.equal(fixture.state.npcs.size, 0);
  assert.equal(fixture.state.vehicles.size, 0);
  assert.equal(fixture.released.length, 5);
  assert.equal(fixture.controller.diagnostics().activePedestrians, 0);
  assert.equal(fixture.controller.diagnostics().activeTraffic, 0);
});

test('combat pedestrians and damaged traffic remain pinned outside every player cell', () => {
  const fixture = createFixture();
  fixture.controller.initialize(0);
  fixture.controller.update([{x: 0, y: 0}], 100);
  const pinnedNpc = [...fixture.state.npcs.keys()][0];
  const pinnedVehicle = [...fixture.state.vehicles.values()][0];
  fixture.pinnedPedestrians.add(pinnedNpc);
  pinnedVehicle.damageFront = 1;
  pinnedVehicle.health--;

  fixture.controller.update([{x: 10_000, y: 10_000}], 200);
  assert.equal(fixture.state.npcs.has(pinnedNpc), true);
  assert.equal(fixture.state.vehicles.has(pinnedVehicle.id), true);
  assert.equal(fixture.controller.diagnostics().pinnedPedestrians, 1);
  assert.equal(fixture.controller.diagnostics().pinnedTraffic, 1);
});

function createFixture() {
  const state = new DistrictState();
  const pinnedPedestrians = new Set<string>();
  const registered: string[] = [];
  const released: string[] = [];
  const world = {
    tileWidth: 64,
    tileHeight: 64,
    openPoint: (index: number) => ({x: (index - 5_000) * 4, y: 0}),
    pedestrianSpawn: (index: number) => ({x: (index - 5_000) * 4, y: 0}),
    openPointNear: (x: number, y: number) => ({x: x + 64, y}),
    trafficSpawn: (index: number): TrafficSpawn => {
      const column = Math.round((index - 10_000) / 193) * 2;
      return {
        x: column * 64,
        y: 0,
        column,
        row: 0,
        targetColumn: column + 1,
        targetRow: 0,
        angle: 0
      };
    },
    roadNeighbors: (column: number, row: number): RoadNode[] => [
      {column: column - 1, row},
      {column: column + 1, row}
    ],
    roadPoint: (node: RoadNode) => ({x: node.column * 64, y: node.row * 64}),
    nearestRoadNode: (x: number, y: number) => ({
      column: Math.round(x / 64),
      row: Math.round(y / 64)
    }),
    canOccupy: () => true,
    isRoadAt: () => true
  } as unknown as CollisionMap;
  const pedestrians = {
    spawnAmbientAt: (id: string, kind: 'civilian' | 'police', x: number, y: number, angle: number) => {
      const npc = new NpcState();
      npc.id = id;
      npc.kind = kind;
      npc.x = x;
      npc.y = y;
      npc.angle = angle;
      state.npcs.set(id, npc);
      return npc;
    },
    canStreamOut: (id: string) => state.npcs.has(id) && !pinnedPedestrians.has(id),
    streamOutAmbient: (id: string) => {
      if (pinnedPedestrians.has(id)) return false;
      return state.npcs.delete(id);
    }
  };
  const controller = new PopulationStreamingController({
    state,
    world,
    random: new DeterministicRandom('population-test'),
    pedestrians,
    traffic: {
      register: (id: string) => registered.push(id),
      release: (id: string) => released.push(id)
    }
  });
  return {state, controller, registered, released, pinnedPedestrians};
}

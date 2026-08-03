import assert from 'node:assert/strict';
import test from 'node:test';
import type {BuildingDefinition} from '../shared/content/building-manifest.ts';
import {
  addBuildingOccluder,
  partitionBuildingChunk,
  type MutableGeometryChunk,
  type MutableGeometryWorld
} from '../server/world-content/building-geometry-partitioner.ts';

const building = {
  id: 'test-store',
  label: 'Test Store',
  mode: 'seamless-cutaway',
  kind: 'store',
  floorZ: 2,
  roofHeight: 3,
  shell: {
    cutawayMode: 'complete-above-floor',
    bounds: {minX: 10, minY: 10, maxX: 11, maxY: 11, minZ: 2.9, maxZ: 5.1},
    expectedTriangleCount: 1
  },
  bounds: {minX: 10, minY: 10, maxX: 11, maxY: 11},
  footprints: [{minX: 10, minY: 10, maxX: 11, maxY: 11}],
  floorConnectors: [],
  revealAreas: [{minX: 10, minY: 10, maxX: 11, maxY: 11}],
  entrance: {side: 'south', x: 10.5, y: 11, width: 0.875},
  serviceBindings: [],
  obstacles: []
} as unknown as BuildingDefinition;

test('incremental building partition moves matching triangles into a named roof group', () => {
  const vertices = [
    vertex(0, 0, 3), vertex(1, 0, 3), vertex(0, 1, 3),
    vertex(2, 2, 3), vertex(3, 2, 3), vertex(2, 3, 3)
  ];
  const source: MutableGeometryChunk = {
    version: 1,
    column: 1,
    row: 1,
    x: 10,
    y: 10,
    size: 8,
    vertices,
    opaqueIndices: [0, 1, 2, 3, 4, 5],
    alphaTestedIndices: [],
    occluders: [],
    triangleCount: 2
  };
  const result = partitionBuildingChunk(source, building);
  assert.equal(result.triangleCount, 1);
  assert.deepEqual(result.chunk.opaqueIndices, [3, 4, 5]);
  assert.deepEqual(result.chunk.occluders, [{
    id: 'test-store',
    opaqueIndices: [0, 1, 2],
    alphaTestedIndices: [],
    triangleCount: 1
  }]);
  assert.equal(result.chunk.triangleCount, 2, 'partitioning must not change total rendered triangles');
  assert.deepEqual(source.opaqueIndices, [0, 1, 2, 3, 4, 5], 'source payload remains immutable');
});

test('incremental building partition adds the matching world occluder contract', () => {
  const source = {
    version: 1,
    revision: 'base-revision',
    blockSize: 64,
    occluders: [],
    chunks: [],
    triangleCount: 2
  } as MutableGeometryWorld;
  const world = addBuildingOccluder(source, building, 1, 'builder-revision');
  assert.equal(world.revision, 'builder-revision');
  assert.deepEqual(world.occluders, [{
    id: 'test-store',
    bounds: building.shell.bounds,
    exteriorDoor: {x: 10.5, y: 11},
    floorZ: 2,
    triangleCount: 1
  }]);
  assert.deepEqual(source.occluders, []);
});

function vertex(x: number, y: number, z: number) {
  return {x, y, z, u: 0, v: 0, tile: 0, shade: 1};
}

import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import rawBuildings from '../shared/content/buildings/buildings.json';
import {publishBuildingDraft} from '../server/world-content/building-publication.ts';

test('local Builder Gun publication promotes a draft and partitions exported geometry', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hoodlyfe-building-publication-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const geometry = join(root, 'public', 'assets', 'maps', 'geometry');
  const buildings = join(root, 'shared', 'content', 'buildings');
  await mkdir(join(geometry, 'chunks'), {recursive: true});
  await mkdir(buildings, {recursive: true});
  await json(join(buildings, 'buildings.json'), rawBuildings);
  await json(join(geometry, 'world.json'), {
    version: 1,
    revision: 'fixture-base',
    blockSize: 64,
    occluders: [],
    chunks: [{id: '1:1', column: 1, row: 1, x: 10, y: 10, size: 8, file: 'chunks/1-1.json', triangleCount: 1}],
    triangleCount: 1
  });
  await json(join(geometry, 'chunks', '1-1.json'), {
    version: 1,
    column: 1,
    row: 1,
    x: 10,
    y: 10,
    size: 8,
    vertices: [vertex(0, 0, 3), vertex(1, 0, 3), vertex(0, 1, 3)],
    opaqueIndices: [0, 1, 2],
    alphaTestedIndices: [],
    occluders: [],
    triangleCount: 1
  });
  const result = await publishBuildingDraft('bil', draft(), 'test-author', {NODE_ENV: 'development'}, root);
  assert.equal(result.buildingId, 'store-building-10-10-fixture');
  assert.equal(result.triangleCount, 1);
  assert.equal(result.changedChunks, 1);
  const manifest = await readJson(join(buildings, 'buildings.json'));
  const published = manifest.buildings.find((building: {id: string}) => building.id === result.buildingId);
  assert.equal(published.shell.expectedTriangleCount, 1);
  const world = await readJson(join(geometry, 'world.json'));
  assert.equal(world.occluders[0].id, result.buildingId);
  const chunk = await readJson(join(geometry, 'chunks', '1-1.json'));
  assert.deepEqual(chunk.opaqueIndices, []);
  assert.deepEqual(chunk.occluders[0].opaqueIndices, [0, 1, 2]);
  assert.equal(chunk.triangleCount, 1);
});

function draft() {
  return {
    version: 1,
    generatedBy: 'nock0-builder-gun',
    status: 'needs-export',
    candidateId: 'building-10-10-fixture',
    building: {
      id: 'store-building-10-10-fixture',
      label: 'New Convenience Store',
      mode: 'seamless-cutaway',
      kind: 'store',
      floorZ: 2,
      roofHeight: 3,
      shell: {
        cutawayMode: 'complete-above-floor',
        bounds: {minX: 10, minY: 10, maxX: 11, maxY: 11, minZ: 2.9, maxZ: 5.1},
        expectedTriangleCount: null
      },
      bounds: {minX: 10, minY: 10, maxX: 11, maxY: 11},
      footprints: [{minX: 10, minY: 10, maxX: 11, maxY: 11}],
      floorConnectors: [],
      revealAreas: [{minX: 10, minY: 10, maxX: 11, maxY: 11}],
      entrance: {side: 'south', x: 10.5, y: 11, width: 0.875},
      signage: {exterior: 'QUICK MART', service: 'CHECKOUT'},
      serviceBindings: [{id: 'store-checkout', type: 'shop', label: 'Store Checkout', x: 10.5, y: 10.25}],
      obstacles: []
    }
  };
}

function vertex(x: number, y: number, z: number) {
  return {x, y, z, u: 0, v: 0, tile: 0, shade: 1};
}

async function json(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, 'utf8'));
}

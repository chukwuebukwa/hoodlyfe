import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  assembleLevelDocument,
  createArtifactBundle,
  type DistrictMapMetadata,
  type LaneGraphDocument,
  type TiledMapDocument
} from '../src/tools/level-editor/level-document.ts';
import {compilePlaytestWorld} from '../server/editor/playtest-world-loader.ts';

test('level editor round-trip changes owned layers without touching ground art', async () => {
  const source = await loadArtifacts();
  const document = assembleLevelDocument(source.map, source.metadata, source.lanes);
  const groundBefore = structuredClone(source.map.layers.find((layer) => layer.name === 'ground'));
  document.layers.collision[0] = document.layers.collision[0] === 0 ? 1 : 0;
  document.layers.roads[1] = document.layers.roads[1] === 0 ? 1 : 0;
  document.spawns[0].x = 8256;
  document.lanes.corridors[0].speedLimit = 88;
  document.lanes.corridors[0].direction = 'forward';

  const bundle = createArtifactBundle(document, source, '2026-07-19T00:00:00.000Z');

  const outputMap = bundle.files['public/assets/maps/district-map.json'];
  assert.deepEqual(outputMap.layers.find((layer) => layer.name === 'ground'), groundBefore);
  assert.equal(outputMap.layers.find((layer) => layer.name === 'collisions')?.data?.[0], document.layers.collision[0]);
  assert.equal(outputMap.layers.find((layer) => layer.name === 'roads')?.data?.[1], document.layers.roads[1]);
  assert.equal(bundle.files['public/assets/maps/district-map.metadata.json'].spawn.x, 8256);
  assert.equal(bundle.files['public/assets/maps/district-lanes.json'].corridors[0].speedLimit, 88);
  assert.equal(bundle.files['public/assets/maps/district-lanes.json'].corridors[0].direction, 'forward');
  assert.equal(bundle.editorDocument.lanes.corridors[0].direction, 'forward');
  assert.equal(bundle.generatedAt, '2026-07-19T00:00:00.000Z');
});

test('level editor rejects incompatible map metadata', async () => {
  const source = await loadArtifacts();
  const metadata = {...source.metadata, size: {width: source.metadata.size.width - 1, height: source.metadata.size.height}};
  assert.throws(() => assembleLevelDocument(source.map, metadata, source.lanes), /dimensions/);
});

test('Preview compiles the saved one-way carriageways into the authoritative world', async () => {
  const source = await loadArtifacts();
  const document = assembleLevelDocument(source.map, source.metadata, source.lanes);
  const preview = compilePlaytestWorld('bil', 'one-way-preview', document);
  const northEdges = preview.laneGraph.edges().filter((edge) => edge.kind === 'lane' && edge.id.startsWith('south-boulevard-north:'));
  const southEdges = preview.laneGraph.edges().filter((edge) => edge.kind === 'lane' && edge.id.startsWith('south-boulevard-south:'));

  assert.ok(northEdges.length > 0);
  assert.ok(southEdges.length > 0);
  assert.equal(northEdges.every((edge) => edge.id.includes(':reverse')), true);
  assert.equal(southEdges.every((edge) => edge.id.includes(':forward')), true);
  assert.ok(preview.laneGraph.edges().some((edge) => edge.junctionId === 'south-boulevard-west-south-return'));
  assert.ok(preview.laneGraph.edges().some((edge) => edge.junctionId === 'south-boulevard-east-south-return'));
});

async function loadArtifacts(): Promise<{
  map: TiledMapDocument;
  metadata: DistrictMapMetadata;
  lanes: LaneGraphDocument;
}> {
  const [map, metadata, lanes] = await Promise.all([
    readJson<TiledMapDocument>('public/assets/maps/district-map.json'),
    readJson<DistrictMapMetadata>('public/assets/maps/district-map.metadata.json'),
    readJson<LaneGraphDocument>('public/assets/maps/district-lanes.json')
  ]);
  return {map, metadata, lanes};
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

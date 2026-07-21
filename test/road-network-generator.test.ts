import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {LaneGraph} from '../server/game/traffic/lane-graph.ts';
import {CollisionMap} from '../server/world-map.ts';
import {
  assembleLevelDocument,
  type DistrictMapMetadata,
  type LaneGraphDocument,
  type TiledMapDocument
} from '../src/tools/level-editor/level-document.ts';
import {generateRoadNetwork} from '../src/tools/level-editor/road-network-generator.ts';
import {validateLevelDocument} from '../src/tools/level-editor/level-validation.ts';

test('full BIL road surface generates a deterministic playable lane network', () => {
  const map = readJson<TiledMapDocument>('public/assets/maps/district-map.json');
  const metadata = readJson<DistrictMapMetadata>('public/assets/maps/district-map.metadata.json');
  const lanes = readJson<LaneGraphDocument>('public/assets/maps/district-lanes.json');
  const document = assembleLevelDocument(map, metadata, lanes);

  const first = generateRoadNetwork(document);
  const second = generateRoadNetwork(document);

  assert.deepEqual(second, first);
  assert.ok(first.stats.retainedRoadCells > 15_000);
  assert.ok(first.stats.corridors > 300);
  assert.ok(first.stats.junctions > 180);
  assert.equal(first.lanes.roadblocks?.length, lanes.roadblocks?.length);
  assert.equal(validateLevelDocument({...document, lanes: first.lanes}).counts.error, 0);

  const graph = LaneGraph.fromDocument(first.lanes, CollisionMap.load());
  assert.ok(graph.nodes().length > 2_000);
  assert.ok(graph.edges().length > 3_000);
  assert.ok(graph.nodes().every((node) => graph.outgoing(node.id).length > 0));
  assert.ok(graph.roadblocks().every((roadblock) => (
    roadblock.blockedEdgeIds.every((edgeId) => Boolean(graph.edge(edgeId)))
  )));
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

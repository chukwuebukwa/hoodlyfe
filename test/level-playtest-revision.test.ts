import assert from 'node:assert/strict';
import test from 'node:test';
import {LEVEL_EDITOR_SCHEMA_VERSION, type LevelEditorDocument} from '../src/tools/level-editor/level-document.ts';
import {
  createLocalPlaytestRevision,
  hashLevelDocument,
  isCompatiblePlaytestRevision
} from '../src/tools/level-editor/playtest-revision.ts';

test('playtest revisions are deterministic and content addressed', async () => {
  const first = fixture();
  const reordered = {
    ...first,
    layers: {
      collision: [...first.layers.collision],
      roads: [...first.layers.roads]
    },
    map: {
      origin: {...first.map.origin},
      tileSize: first.map.tileSize,
      height: first.map.height,
      width: first.map.width,
      source: first.map.source
    }
  } satisfies LevelEditorDocument;

  assert.equal(await hashLevelDocument(first), await hashLevelDocument(reordered));
  reordered.layers.collision[0] = 1;
  assert.notEqual(await hashLevelDocument(first), await hashLevelDocument(reordered));
});

test('playtest revisions retain immutable snapshots and reject another map source', async () => {
  const document = fixture();
  const revision = await createLocalPlaytestRevision(document, '2026-07-20T00:00:00.000Z');
  document.spawns[0].x = 999;

  assert.equal(revision.document.spawns[0].x, 32);
  assert.equal(revision.createdAt, '2026-07-20T00:00:00.000Z');
  assert.equal(isCompatiblePlaytestRevision(revision, fixture()), true);
  assert.equal(isCompatiblePlaytestRevision(revision, {
    ...fixture(),
    map: {...fixture().map, source: 'another-source'}
  }), false);
});

function fixture(): LevelEditorDocument {
  return {
    schemaVersion: LEVEL_EDITOR_SCHEMA_VERSION,
    id: 'wil',
    title: 'WIL District',
    map: {source: 'wil.gmp', width: 2, height: 2, tileSize: 64, origin: {x: 0, y: 0}},
    layers: {collision: [0, 0, 0, 0], roads: [1, 1, 1, 1]},
    lanes: {
      schemaVersion: 2,
      districtId: 'wil',
      driveSide: 'right',
      laneOffset: 24,
      laneSpacing: 40,
      corridors: [],
      junctions: []
    },
    spawns: [{
      id: 'player-default',
      label: 'Player Spawn',
      kind: 'player',
      x: 32,
      y: 32,
      angle: 0,
      enabled: true
    }]
  };
}

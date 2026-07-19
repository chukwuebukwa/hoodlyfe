import assert from 'node:assert/strict';
import test from 'node:test';
import {LEVEL_EDITOR_SCHEMA_VERSION, type LevelEditorDocument} from '../src/tools/level-editor/level-document.ts';
import {reconcileSelection} from '../src/tools/level-editor/editor-ui.ts';

test('selection follows an entity id through undo and redo documents', () => {
  const before = fixture('west-avenue');
  const after = fixture('west-avenue-renamed');

  assert.deepEqual(
    reconcileSelection({kind: 'corridor', id: 'west-avenue-renamed', pointIndex: 1}, after, before),
    {kind: 'corridor', id: 'west-avenue', pointIndex: 1}
  );
  assert.deepEqual(
    reconcileSelection({kind: 'corridor', id: 'west-avenue', pointIndex: 1}, before, after),
    {kind: 'corridor', id: 'west-avenue-renamed', pointIndex: 1}
  );
});

function fixture(corridorId: string): LevelEditorDocument {
  return {
    schemaVersion: LEVEL_EDITOR_SCHEMA_VERSION,
    id: 'fixture',
    title: 'Fixture',
    map: {source: 'test', width: 2, height: 2, tileSize: 64, origin: {x: 0, y: 0}},
    layers: {collision: [0, 0, 0, 0], roads: [1, 1, 1, 1]},
    lanes: {
      schemaVersion: 2,
      districtId: 'fixture',
      driveSide: 'right',
      laneOffset: 24,
      laneSpacing: 40,
      corridors: [{id: corridorId, speedLimit: 80, points: [{x: 32, y: 32}, {x: 96, y: 32}]}],
      junctions: []
    },
    spawns: []
  };
}

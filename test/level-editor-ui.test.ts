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

test('beacon source and target handle selections survive undo and redo', () => {
  const before = fixture('west-avenue');
  const after = structuredClone(before);
  before.beacons = [beacon('repair-entrance')];
  after.beacons = [beacon('repair-entrance-renamed')];

  assert.deepEqual(
    reconcileSelection({kind: 'beacon', id: 'repair-entrance-renamed', handle: 'target'}, after, before),
    {kind: 'beacon', id: 'repair-entrance', handle: 'target'}
  );
  assert.deepEqual(
    reconcileSelection({kind: 'beacon', id: 'repair-entrance', handle: 'source'}, before, after),
    {kind: 'beacon', id: 'repair-entrance-renamed', handle: 'source'}
  );
});

function beacon(id: string) {
  return {
    id,
    label: 'Repair entrance',
    enabled: true,
    x: 32,
    y: 32,
    z: 110,
    targetX: 64,
    targetY: 64,
    targetZ: 35,
    color: '#20dcff',
    intensity: 0.82,
    radius: 88,
    footprintWidth: 215.6,
    footprintHeight: 176
  };
}

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

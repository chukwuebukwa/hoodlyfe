import assert from 'node:assert/strict';
import test from 'node:test';
import {LEVEL_EDITOR_SCHEMA_VERSION, type LevelEditorDocument} from '../src/tools/level-editor/level-document.ts';
import {
  playtestBlockingValidationIssues,
  validateLevelDocument
} from '../src/tools/level-editor/level-validation.ts';

test('validation reports blocked spawns, off-road corridors, and missing junction references', () => {
  const document = fixture();
  const report = validateLevelDocument(document);
  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.ok(codes.has('spawn-blocked'));
  assert.ok(codes.has('corridor-off-road'));
  assert.ok(codes.has('junction-corridor-missing'));
  assert.equal(report.counts.error, 2);
  assert.ok(report.counts.warning >= 2);
});

test('validation accepts a minimal coherent level document', () => {
  const document = fixture();
  document.layers.collision[0] = 0;
  document.layers.roads.fill(1);
  document.lanes.junctions = [];
  const report = validateLevelDocument(document);
  assert.equal(report.counts.error, 0);
});

test('validation rejects a junction that is referenced by but does not lie on a corridor', () => {
  const document = fixture();
  document.layers.collision[0] = 0;
  document.layers.roads.fill(1);
  document.lanes.corridors.push({
    id: 'cross',
    speedLimit: 80,
    points: [{x: 64, y: 0}, {x: 64, y: 127}]
  });
  document.lanes.junctions = [{
    id: 'offset-junction',
    x: 64,
    y: 33,
    corridors: ['main', 'cross']
  }];

  const report = validateLevelDocument(document);
  const issues = report.issues.filter((issue) => issue.code === 'junction-off-corridor');
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /main/);
  assert.equal(report.counts.error, 1);
  assert.equal(playtestBlockingValidationIssues(report).length, 0);
});

test('validation accepts a junction on every referenced corridor segment', () => {
  const document = fixture();
  document.layers.collision[0] = 0;
  document.layers.roads.fill(1);
  document.lanes.corridors.push({
    id: 'cross',
    speedLimit: 80,
    points: [{x: 64, y: 0}, {x: 64, y: 127}]
  });
  document.lanes.junctions = [{
    id: 'valid-junction',
    x: 64,
    y: 32,
    corridors: ['main', 'cross']
  }];

  const report = validateLevelDocument(document);
  assert.equal(report.issues.some((issue) => issue.code === 'junction-off-corridor'), false);
  assert.equal(report.counts.error, 0);
});

test('validation rejects empty entity ids before export', () => {
  const document = fixture();
  document.spawns[0].id = '';
  document.lanes.corridors[0].id = '';
  document.lanes.junctions = [];
  const codes = new Set(validateLevelDocument(document).issues.map((issue) => issue.code));
  assert.ok(codes.has('spawn-id-empty'));
  assert.ok(codes.has('corridor-id-empty'));
});

function fixture(): LevelEditorDocument {
  return {
    schemaVersion: LEVEL_EDITOR_SCHEMA_VERSION,
    id: 'fixture',
    title: 'Fixture',
    map: {source: 'test', width: 2, height: 2, tileSize: 64, origin: {x: 0, y: 0}},
    layers: {collision: [1, 0, 0, 0], roads: [0, 0, 0, 0]},
    lanes: {
      schemaVersion: 2,
      districtId: 'fixture',
      driveSide: 'right',
      laneOffset: 24,
      laneSpacing: 40,
      corridors: [{id: 'main', speedLimit: 80, points: [{x: 32, y: 32}, {x: 96, y: 32}]}],
      junctions: [{id: 'bad-junction', x: 64, y: 64, corridors: ['missing']}]
    },
    spawns: [{id: 'player-default', label: 'Player', kind: 'player', x: 32, y: 32, angle: 0, enabled: true}]
  };
}

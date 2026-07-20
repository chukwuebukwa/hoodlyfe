import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compiledLaneEdgeDiagnostic,
  compiledLaneEdgeIdFromMessage,
  compiledLaneEdgeLabel
} from '../src/tools/level-editor/compiled-lane-diagnostic.ts';
import type {LaneGraphDocument, LevelEditorDocument} from '../src/tools/level-editor/level-document.ts';
import {validateLevelDocument, withRuntimeLaneIssues} from '../src/tools/level-editor/level-validation.ts';

const lanes: LaneGraphDocument = {
  schemaVersion: 2,
  districtId: 'test',
  driveSide: 'right',
  laneOffset: 24,
  laneSpacing: 40,
  corridors: [{
    id: 'south-boulevard-north',
    speedLimit: 100,
    lanesPerDirection: 2,
    points: [{x: 0, y: 0}, {x: 100, y: 0}]
  }],
  junctions: [
    {id: 'west', x: 25, y: 0, corridors: ['south-boulevard-north', 'cross-west']},
    {id: 'east', x: 75, y: 0, corridors: ['south-boulevard-north', 'cross-east']}
  ]
};

test('compiled lane diagnostics identify the exact offset segment named by the runtime', () => {
  const diagnostic = compiledLaneEdgeDiagnostic(
    lanes,
    'south-boulevard-north:forward:lane-1:edge:2'
  );
  assert.deepEqual(diagnostic, {
    edgeId: 'south-boulevard-north:forward:lane-1:edge:2',
    corridorId: 'south-boulevard-north',
    direction: 'forward',
    laneIndex: 1,
    edgeIndex: 2,
    from: {x: 75, y: 64},
    to: {x: 100, y: 64},
    midpoint: {x: 87.5, y: 64}
  });
  assert.equal(compiledLaneEdgeLabel(diagnostic!), 'forward lane 2, segment 3');
});

test('compiled lane diagnostics reverse the samples and offset opposing traffic', () => {
  const diagnostic = compiledLaneEdgeDiagnostic(
    lanes,
    'south-boulevard-north:reverse:lane-1:edge:1'
  );
  assert.deepEqual(diagnostic?.from, {x: 75, y: -64});
  assert.deepEqual(diagnostic?.to, {x: 25, y: -64});
});

test('compiled lane diagnostics reject an edge direction omitted by its corridor', () => {
  const oneWay = structuredClone(lanes);
  oneWay.corridors[0].direction = 'forward';
  assert.equal(
    compiledLaneEdgeDiagnostic(oneWay, 'south-boulevard-north:reverse:edge:0'),
    undefined
  );
});

test('runtime lane errors become selectable editor validation issues', () => {
  const message = 'Edge south-boulevard-north:forward:lane-1:edge:2 crosses blocked or non-road space.';
  assert.equal(
    compiledLaneEdgeIdFromMessage(message),
    'south-boulevard-north:forward:lane-1:edge:2'
  );
  const document: LevelEditorDocument = {
    schemaVersion: 1,
    id: 'test',
    title: 'Test',
    map: {source: 'test', width: 2, height: 2, tileSize: 64, origin: {x: 0, y: 0}},
    layers: {collision: [0, 0, 0, 0], roads: [1, 1, 1, 1]},
    lanes,
    spawns: [{id: 'spawn', label: 'Spawn', kind: 'player', angle: 0, enabled: true, x: 10, y: 10}]
  };
  const report = withRuntimeLaneIssues(validateLevelDocument(document), document, [message]);
  const issue = report.issues.find((candidate) => candidate.code === 'compiled-lane-blocked');
  assert.ok(issue);
  assert.equal(issue.entityId, 'south-boulevard-north');
  assert.deepEqual(issue.point, {x: 87.5, y: 64});
  assert.match(issue.message, /forward lane 2, segment 3/);
});

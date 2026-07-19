import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellPatchCommand,
  createEditorHistory,
  documentCommand,
  executeCommand,
  redoCommand,
  undoCommand
} from '../src/tools/level-editor/editor-history.ts';
import {LEVEL_EDITOR_SCHEMA_VERSION, type LevelEditorDocument} from '../src/tools/level-editor/level-document.ts';

test('cell history compacts a stroke and supports undo and redo', () => {
  const original = fixture();
  const command = cellPatchCommand('Paint collision', 'collision', [
    {index: 1, before: 0, after: 1},
    {index: 1, before: 1, after: 2},
    {index: 2, before: 0, after: 1}
  ]);
  const executed = executeCommand(original, createEditorHistory(), command);
  assert.deepEqual(executed.document.layers.collision, [0, 2, 1, 0]);

  const undone = undoCommand(executed.document, executed.history);
  assert.deepEqual(undone.document.layers.collision, [0, 0, 0, 0]);
  assert.equal(undone.history.future.length, 1);

  const redone = redoCommand(undone.document, undone.history);
  assert.deepEqual(redone.document.layers.collision, [0, 2, 1, 0]);
});

test('new commands clear the redo branch', () => {
  const original = fixture();
  const renamed = {...original, title: 'Renamed'};
  const first = executeCommand(original, createEditorHistory(), documentCommand('Rename', original, renamed));
  const undone = undoCommand(first.document, first.history);
  const next = executeCommand(undone.document, undone.history, cellPatchCommand('Paint road', 'roads', [
    {index: 0, before: 0, after: 1}
  ]));
  assert.equal(next.history.future.length, 0);
});

function fixture(): LevelEditorDocument {
  return {
    schemaVersion: LEVEL_EDITOR_SCHEMA_VERSION,
    id: 'fixture',
    title: 'Fixture',
    map: {source: 'test', width: 2, height: 2, tileSize: 64, origin: {x: 0, y: 0}},
    layers: {collision: [0, 0, 0, 0], roads: [0, 0, 0, 0]},
    lanes: {
      schemaVersion: 2,
      districtId: 'fixture',
      driveSide: 'right',
      laneOffset: 24,
      laneSpacing: 40,
      corridors: [],
      junctions: []
    },
    spawns: []
  };
}

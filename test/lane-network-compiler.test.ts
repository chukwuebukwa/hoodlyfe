import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileLaneNetwork,
  type LaneCompilerDocument
} from '../shared/traffic/lane-network-compiler.ts';

test('intersection compiler derives approaches, legal turns, curves, and signal phases', () => {
  const compiled = compileLaneNetwork(crossIntersection());

  assert.equal(compiled.approaches.filter(({role}) => role === 'incoming').length, 4);
  assert.equal(compiled.approaches.filter(({role}) => role === 'outgoing').length, 4);
  assert.deepEqual(
    countTurns(compiled.movements),
    {left: 4, right: 4, straight: 4}
  );
  assert.ok(compiled.movements.every(({path}) => (
    path.length >= 3 && path.every(({x, y}) => Number.isFinite(x) && Number.isFinite(y))
  )));
  assert.ok(compiled.movements.filter(({turn}) => turn !== 'straight').every(({connectorEdgeId}) => connectorEdgeId));
  assert.ok(compiled.movements.filter(({turn}) => turn === 'straight').every(({connectorEdgeId}) => !connectorEdgeId));
  assert.ok(compiled.signalGroups.length > 0);
  assert.deepEqual(
    new Set(compiled.signalGroups.flatMap(({movementIds}) => movementIds)),
    new Set(compiled.movements.map(({id}) => id))
  );
});

test('one-way corridors omit the disabled direction from approaches and movements', () => {
  const document = crossIntersection();
  document.corridors[0].direction = 'forward';
  const compiled = compileLaneNetwork(document);

  assert.ok(compiled.nodes.some(({corridorId, direction}) => corridorId === 'east-west' && direction === 'forward'));
  assert.ok(!compiled.nodes.some(({corridorId, direction}) => corridorId === 'east-west' && direction === 'reverse'));
  assert.ok(!compiled.approaches.some(({corridorId, direction}) => corridorId === 'east-west' && direction === 'reverse'));
  assert.ok(!compiled.movements.some(({entryLaneId, exitLaneId}) => (
    entryLaneId.includes('east-west:reverse') || exitLaneId.includes('east-west:reverse')
  )));
});

test('lane-role rules constrain two-lane turns without removing straight travel', () => {
  const document = crossIntersection();
  document.corridors.forEach((corridor) => { corridor.lanesPerDirection = 2; });
  const compiled = compileLaneNetwork(document);

  const leftTurns = compiled.movements.filter(({turn}) => turn === 'left');
  const rightTurns = compiled.movements.filter(({turn}) => turn === 'right');
  const straight = compiled.movements.filter(({turn}) => turn === 'straight');
  assert.ok(leftTurns.every(({entryApproachId}) => entryApproachId.includes(':forward:incoming') || entryApproachId.includes(':reverse:incoming')));
  assert.ok(leftTurns.every(({entryApproachId}) => !entryApproachId.includes(':lane-1:')));
  assert.ok(rightTurns.every(({entryApproachId}) => entryApproachId.includes(':lane-1:')));
  assert.equal(straight.length, 8);
});

function crossIntersection(): LaneCompilerDocument {
  return {
    laneOffset: 12,
    laneSpacing: 20,
    corridors: [
      {id: 'east-west', speedLimit: 80, points: [{x: -100, y: 0}, {x: 100, y: 0}]},
      {id: 'north-south', speedLimit: 80, points: [{x: 0, y: -100}, {x: 0, y: 100}]}
    ],
    junctions: [{id: 'center', x: 0, y: 0, corridors: ['east-west', 'north-south']}]
  };
}

function countTurns(movements: ReturnType<typeof compileLaneNetwork>['movements']): Record<'left' | 'right' | 'straight', number> {
  return movements.reduce((counts, movement) => {
    counts[movement.turn]++;
    return counts;
  }, {left: 0, right: 0, straight: 0});
}

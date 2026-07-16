import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POPULATION_LOOKAHEAD,
  populationInterestAnchorsFor,
  populationInterestAnchorsForPlayers
} from '../server/game/population/population-interest-anchor-policy.ts';

test('on-foot and slow observers use only the real visibility anchor', () => {
  assert.deepEqual(populationInterestAnchorsFor({x: 10, y: 20, angle: 1, speed: 0}), [{
    x: 10,
    y: 20,
    kind: 'player',
    protectsVisibility: true
  }]);
  assert.equal(populationInterestAnchorsFor({
    x: 0,
    y: 0,
    angle: 0,
    speed: POPULATION_LOOKAHEAD.minimumVehicleSpeed - 1
  }).length, 1);
});

test('fast forward motion adds a bounded non-visibility lookahead anchor', () => {
  const anchors = populationInterestAnchorsFor({x: 100, y: 200, angle: 0, speed: 400});
  assert.equal(anchors.length, 2);
  assert.deepEqual(anchors[1], {
    x: 100 + POPULATION_LOOKAHEAD.maximumDistance,
    y: 200,
    kind: 'lookahead',
    protectsVisibility: false
  });
});

test('reverse motion projects behind the authoritative vehicle heading', () => {
  const anchors = populationInterestAnchorsFor({x: 100, y: 200, angle: Math.PI / 2, speed: -200});
  assert.equal(anchors.length, 2);
  assert.ok(Math.abs((anchors[1]?.x ?? 0) - 100) < 0.000_001);
  assert.equal(anchors[1]?.y, -100);
});

test('invalid observers cannot create population interest', () => {
  assert.deepEqual(populationInterestAnchorsFor({x: Number.NaN, y: 0, angle: 0, speed: 200}), []);
});

test('players share one authoritative lookahead per occupied vehicle', () => {
  const vehicle = {id: 'vehicle-1', x: 100, y: 200, angle: 0, speed: 300};
  const anchors = populationInterestAnchorsForPlayers([
    {id: 'driver', x: 90, y: 200, angle: 1, vehicleId: vehicle.id},
    {id: 'passenger', x: 110, y: 200, angle: 2, vehicleId: vehicle.id},
    {id: 'walker', x: 5_000, y: 5_000, angle: 0, vehicleId: ''}
  ], (vehicleId) => vehicleId === vehicle.id ? vehicle : undefined);
  assert.equal(anchors.filter((anchor) => anchor.kind === 'player').length, 3);
  assert.equal(anchors.filter((anchor) => anchor.kind === 'lookahead').length, 1);
  assert.equal(anchors.find((anchor) => anchor.kind === 'lookahead')?.x, 550);
  assert.deepEqual(
    anchors.filter((anchor) => anchor.kind === 'player').map((anchor) => anchor.ownerId),
    ['driver', 'passenger', 'walker']
  );
});

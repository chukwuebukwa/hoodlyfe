import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POLICE_AWARENESS,
  policeFieldOfViewContains,
  policeSearchZone
} from '../server/game/police/police-awareness-policy.ts';

test('police vision uses a directional field of view with close-range awareness', () => {
  const officer = {x: 100, y: 100, angle: 0};
  assert.equal(policeFieldOfViewContains('foot', officer, {x: 400, y: 100}), true);
  assert.equal(policeFieldOfViewContains('foot', officer, {x: -100, y: 100}), false);
  assert.equal(policeFieldOfViewContains('foot', officer, {x: 70, y: 100}), true);
  assert.equal(policeFieldOfViewContains('foot', officer, {
    x: 100 + POLICE_AWARENESS.foot.range + 1,
    y: 100
  }), false);
});

test('search-zone projection uses the same vision tuning as detection', () => {
  const pose = {x: 44, y: 88, angle: Math.PI / 3};
  assert.deepEqual(policeSearchZone('vehicle', 'cruiser-7', pose), {
    id: 'vehicle:cruiser-7',
    unitId: 'cruiser-7',
    unitKind: 'vehicle',
    ...pose,
    range: POLICE_AWARENESS.vehicle.range,
    halfAngle: POLICE_AWARENESS.vehicle.halfAngle
  });
});

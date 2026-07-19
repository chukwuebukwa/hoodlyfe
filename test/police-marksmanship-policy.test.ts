import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPoliceAimError,
  policeFireDiscipline
} from '../server/game/police/police-marksmanship-policy.ts';

test('police firearms begin at two stars and improve gradually by tier', () => {
  assert.equal(policeFireDiscipline(1, 40).authorized, false);
  const two = policeFireDiscipline(2, 200);
  const three = policeFireDiscipline(3, 200);
  const five = policeFireDiscipline(5, 200);
  assert.equal(two.authorized, true);
  assert.ok(two.cooldownMs > three.cooldownMs);
  assert.ok(two.maximumAngularError > three.maximumAngularError);
  assert.ok(three.maximumAngularError > five.maximumAngularError);
  assert.equal(policeFireDiscipline(2, 331).authorized, false);
});

test('police aim error is deterministic, centered, and bounded', () => {
  assert.equal(applyPoliceAimError(1, 0.2, 0.5), 1);
  assert.equal(applyPoliceAimError(1, 0.2, 0), 0.8);
  assert.equal(applyPoliceAimError(1, 0.2, 1), 1.2);
});

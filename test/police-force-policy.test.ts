import assert from 'node:assert/strict';
import test from 'node:test';
import {
  custodyFineForWanted,
  decidePoliceForce,
  type PoliceForceContext
} from '../server/game/police/police-force-policy.ts';

const BASE: PoliceForceContext = {
  role: 'primary',
  officerInControl: true,
  targetAlive: true,
  targetWantedLevel: 2,
  targetAction: '',
  targetOnFootInStreet: true,
  canSeeTarget: true,
  targetDistance: 40
};

test('primary police select custody only for visible arrestable contact', () => {
  assert.deepEqual(decidePoliceForce(BASE), {
    response: 'arrest',
    reason: 'custody-contact',
    stopForContact: true
  });
  assert.equal(decidePoliceForce({...BASE, role: 'contain-left'}).response, 'fire');
  assert.equal(decidePoliceForce({...BASE, targetAction: 'melee'}).response, 'melee');
  assert.equal(decidePoliceForce({...BASE, targetAction: 'arrested'}).response, 'hold');
  assert.equal(decidePoliceForce({...BASE, targetOnFootInStreet: false}).response, 'fire');
  assert.equal(decidePoliceForce({...BASE, canSeeTarget: false}).response, 'hold');
});

test('custody fines scale predictably with bounded wanted level', () => {
  assert.equal(custodyFineForWanted(0), 200);
  assert.equal(custodyFineForWanted(1), 200);
  assert.equal(custodyFineForWanted(2), 800);
  assert.equal(custodyFineForWanted(3), 1800);
  assert.equal(custodyFineForWanted(5), 5000);
  assert.equal(custodyFineForWanted(99), 5000);
});

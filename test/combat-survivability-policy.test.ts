import assert from 'node:assert/strict';
import test from 'node:test';
import {
  impactDirection,
  reactionKindFor,
  reactionPriority,
  resolveDamage
} from '../server/game/combat/combat-survivability-policy.ts';

test('armor absorbs accepted damage before health and supports explicit bypass', () => {
  assert.deepEqual(resolveDamage(100, 60, 25), {
    acceptedDamage: 25,
    armorDamage: 25,
    healthDamage: 0,
    remainingArmor: 35,
    remainingHealth: 100
  });
  assert.deepEqual(resolveDamage(100, 20, 50), {
    acceptedDamage: 50,
    armorDamage: 20,
    healthDamage: 30,
    remainingArmor: 0,
    remainingHealth: 70
  });
  assert.deepEqual(resolveDamage(40, 100, 60, true), {
    acceptedDamage: 40,
    armorDamage: 0,
    healthDamage: 40,
    remainingArmor: 100,
    remainingHealth: 0
  });
});

test('impact direction quantizes the source relative to target heading', () => {
  assert.equal(impactDirection(0, 0, 0, 10, 0), 'front');
  assert.equal(impactDirection(0, 0, 0, 0, -10), 'left');
  assert.equal(impactDirection(0, 0, 0, -10, 0), 'back');
  assert.equal(impactDirection(0, 0, 0, 0, 10), 'right');
  assert.equal(impactDirection(0, 0, Math.PI / 2, 0, 10), 'front');
});

test('reaction strength upgrades heavy and critical-health impacts deterministically', () => {
  assert.equal(reactionKindFor(input('bullet', 'light', 12, 100, 100)), 'flinch');
  assert.equal(reactionKindFor(input('melee', 'medium', 18, 100, 82)), 'stagger');
  assert.equal(reactionKindFor(input('bullet', 'light', 25, 35, 10)), 'knockdown');
  assert.equal(reactionKindFor(input('explosion', 'heavy', 5, 100, 100)), 'knockdown');
  assert.ok(reactionPriority('knockdown') > reactionPriority('stagger'));
  assert.ok(reactionPriority('stagger') > reactionPriority('flinch'));
});

function input(
  family: 'bullet' | 'melee' | 'explosion',
  force: 'light' | 'medium' | 'heavy',
  acceptedDamage: number,
  previousHealth: number,
  remainingHealth: number
) {
  return {family, force, acceptedDamage, previousHealth, remainingHealth};
}

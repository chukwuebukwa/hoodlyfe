import assert from 'node:assert/strict';
import test from 'node:test';
import {CASH_PICKUP_POLICY, deathCashDrop} from '../server/game/pickups/cash-pickup-policy.ts';

test('death cash drop is proportional, bounded, and ignores small or invalid balances', () => {
  assert.equal(deathCashDrop(49), 0);
  assert.equal(deathCashDrop(50), 10);
  assert.equal(deathCashDrop(999), 199);
  assert.equal(deathCashDrop(10_000), CASH_PICKUP_POLICY.maximumDrop);
  assert.equal(deathCashDrop(Number.NaN), 0);
  assert.equal(deathCashDrop(Number.POSITIVE_INFINITY), 0);
});

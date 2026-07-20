import assert from 'node:assert/strict';
import test from 'node:test';
import {
  issuePlaytestTicket,
  verifyPlaytestTicket
} from '../server/editor/playtest-ticket.ts';

test('Play Draft tickets bind one asset source and revision', () => {
  const now = Date.parse('2026-07-20T08:00:00.000Z');
  const token = issuePlaytestTicket('bil', '0123456789abcdefabcd', now);
  const claims = verifyPlaytestTicket(token, {
    assetSourceId: 'bil',
    revision: '0123456789abcdefabcd'
  }, now + 1_000);
  assert.equal(claims.assetSourceId, 'bil');
  assert.equal(claims.revision, '0123456789abcdefabcd');
  assert.ok(claims.expiresAt > now);
  assert.throws(() => verifyPlaytestTicket(token, {
    assetSourceId: 'bil',
    revision: 'fedcba9876543210abcd'
  }, now + 1_000), /mismatched/);
});

test('Play Draft tickets reject tampering and expiration', () => {
  const now = Date.parse('2026-07-20T08:00:00.000Z');
  const token = issuePlaytestTicket('bil', '0123456789abcdefabcd', now);
  assert.throws(() => verifyPlaytestTicket(`${token}x`, {
    assetSourceId: 'bil',
    revision: '0123456789abcdefabcd'
  }, now + 1_000), /signature/);
  assert.throws(() => verifyPlaytestTicket(token, {
    assetSourceId: 'bil',
    revision: '0123456789abcdefabcd'
  }, now + 5 * 60 * 60 * 1_000), /Expired/);
});

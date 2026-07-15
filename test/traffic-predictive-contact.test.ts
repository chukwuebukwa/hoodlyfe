import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sweptOrientedBoxTimeToContact,
  type TrafficMotionBox
} from '../server/game/traffic/traffic-predictive-contact.ts';

test('swept OBB contact finds a perpendicular crossing before overlap', () => {
  const horizontal = box(-100, 0, 0, 80, 0);
  const vertical = box(0, -100, Math.PI / 2, 0, 80);
  const contact = sweptOrientedBoxTimeToContact(horizontal, vertical, 2);
  assert.ok(contact !== undefined);
  assert.ok(contact > 0.65 && contact < 0.75, `Unexpected crossing contact time ${contact}.`);
});

test('swept OBB contact rejects crossing paths whose arrival times do not overlap', () => {
  const horizontal = box(-100, 0, 0, 80, 0);
  const alreadyPassed = box(0, 100, Math.PI / 2, 0, 80);
  assert.equal(sweptOrientedBoxTimeToContact(horizontal, alreadyPassed, 2), undefined);
});

test('swept OBB contact preserves clearance between parallel adjacent lanes', () => {
  const first = box(0, 0, 0, 80, 0);
  const second = box(20, 40, 0, 60, 0);
  assert.equal(sweptOrientedBoxTimeToContact(first, second, 3, 4), undefined);
});

test('swept OBB contact reports immediate overlap', () => {
  const first = box(0, 0, Math.PI / 4, 0, 0);
  const second = box(8, 4, -Math.PI / 4, 0, 0);
  assert.equal(sweptOrientedBoxTimeToContact(first, second, 1), 0);
});

function box(
  x: number,
  y: number,
  angle: number,
  velocityX: number,
  velocityY: number
): TrafficMotionBox {
  return {x, y, angle, velocityX, velocityY, halfLength: 29, halfWidth: 16};
}

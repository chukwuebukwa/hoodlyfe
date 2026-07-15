import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interactionShapesOverlap,
  sweptCircleTimeToContact
} from '../shared/physics/interaction-contact-geometry.ts';

test('interaction contact geometry resolves circle and oriented-box contacts', () => {
  const horizontal = {
    shape: 'box' as const,
    x: 0,
    y: 0,
    angle: 0,
    halfLength: 30,
    halfWidth: 15
  };
  assert.equal(interactionShapesOverlap(horizontal, {
    shape: 'circle', x: 39, y: 0, radius: 10
  }), true);
  assert.equal(interactionShapesOverlap(horizontal, {
    shape: 'circle', x: 41, y: 0, radius: 10
  }), false);
  assert.equal(interactionShapesOverlap(horizontal, {
    shape: 'box', x: 39, y: 0, angle: Math.PI / 2, halfLength: 12, halfWidth: 10
  }), true);
  assert.equal(interactionShapesOverlap(horizontal, {
    shape: 'box', x: 56, y: 0, angle: Math.PI / 2, halfLength: 12, halfWidth: 10
  }), false);
});

test('swept contact returns first impact and rejects separating or late bodies', () => {
  const root = {x: 0, y: 0, velocityX: 0, velocityY: 0, radius: 10};
  assert.equal(sweptCircleTimeToContact(root, {
    x: 100, y: 0, velocityX: -200, velocityY: 0, radius: 10
  }, 1), 0.4);
  assert.equal(sweptCircleTimeToContact(root, {
    x: 100, y: 0, velocityX: 200, velocityY: 0, radius: 10
  }, 1), undefined);
  assert.equal(sweptCircleTimeToContact(root, {
    x: 100, y: 0, velocityX: -20, velocityY: 0, radius: 10
  }, 1), undefined);
  assert.equal(sweptCircleTimeToContact(root, {
    x: 19, y: 0, velocityX: 0, velocityY: 0, radius: 10
  }, 0), 0);
});

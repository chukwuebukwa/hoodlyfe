import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraFollowPolicy,
  cameraTargetKey,
  cameraZoom
} from '../src/game/camera/camera-policy.ts';

test('camera policy keeps responsive zoom and distinct player/vehicle follow modes', () => {
  assert.equal(cameraZoom(699), 1.05);
  assert.equal(cameraZoom(700), 1.15);
  assert.deepEqual(cameraFollowPolicy('player'), {
    lerpX: 0.14,
    lerpY: 0.14,
    centerOnAcquire: true
  });
  assert.deepEqual(cameraFollowPolicy('vehicle'), {
    lerpX: 0.12,
    lerpY: 0.12,
    centerOnAcquire: false
  });
  assert.equal(cameraTargetKey('vehicle', 'taxi-4'), 'vehicle:taxi-4');
});

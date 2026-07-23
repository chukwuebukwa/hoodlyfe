import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraFollowPolicy,
  cameraRecoilOffset,
  cameraTargetKey,
  cameraZoom,
  explorerCameraPose
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

test('camera recoil follows shot direction, camera mode, passengers, and reduced motion', () => {
  assert.deepEqual(cameraRecoilOffset(9, 0, 'overhead'), {x: -9, y: 0, pitch: 0});
  const south = cameraRecoilOffset(9, Math.PI / 2, 'overhead');
  assert.ok(Math.abs(south.x) < 0.000001);
  assert.equal(south.y, 9);
  assert.deepEqual(cameraRecoilOffset(9, 0, 'overhead', true), {
    x: -4.5,
    y: 0,
    pitch: 0
  });
  assert.deepEqual(cameraRecoilOffset(9, 0, 'explorer'), {x: 0, y: 0, pitch: 0.054});
  assert.deepEqual(cameraRecoilOffset(9, 0, 'overhead', false, true), {
    x: 0,
    y: 0,
    pitch: 0
  });
  assert.deepEqual(cameraRecoilOffset(9, Number.NaN, 'overhead'), {x: 0, y: 0, pitch: 0});
});

test('explorer camera follows server heading in the Three.js coordinate frame', () => {
  const east = explorerCameraPose(100, -200, 12, 0, 'player');
  assert.deepEqual(east.position, {x: 100, y: -200, z: 58});
  assert.ok(east.target.x > east.position.x);
  assert.equal(east.target.y, -200);
  assert.ok(east.target.z < east.position.z);

  const south = explorerCameraPose(100, -200, 12, Math.PI / 2, 'vehicle');
  assert.ok(Math.abs(south.target.x - 100) < 0.000001);
  assert.ok(south.target.y < south.position.y);
  assert.equal(south.position.z, 54);
  assert.ok(south.target.z < south.position.z);

  const lookingUp = explorerCameraPose(100, -200, 12, 0, 'player', Math.PI / 6);
  assert.ok(lookingUp.target.z > lookingUp.position.z);
});

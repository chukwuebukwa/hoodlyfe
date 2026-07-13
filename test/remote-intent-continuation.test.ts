import assert from 'node:assert/strict';
import test from 'node:test';
import {continueRemoteIntent} from '../src/game/prediction/remote-intent-continuation.ts';

test('remote intent holds for two ticks, decays for four, then becomes neutral', () => {
  const intent = {
    entityId: 'traffic-1',
    appliedAtServerTick: 10,
    moveX: 0.5,
    moveY: -1,
    steering: 0.8,
    throttle: 1
  };
  assert.equal(continueRemoteIntent(intent, 10).throttle, 1);
  assert.equal(continueRemoteIntent(intent, 12).throttle, 1);
  assert.equal(continueRemoteIntent(intent, 13).throttle, 0.75);
  assert.equal(continueRemoteIntent(intent, 14).throttle, 0.5);
  assert.equal(continueRemoteIntent(intent, 15).throttle, 0.25);
  assert.deepEqual(continueRemoteIntent(intent, 16), {
    moveX: 0,
    moveY: 0,
    steering: 0,
    throttle: 0,
    source: 'neutral'
  });
});

test('remote intent continuation clamps hostile values and freezes accepted output', () => {
  const continued = continueRemoteIntent({
    entityId: 'traffic-1',
    appliedAtServerTick: 1,
    moveX: 4,
    moveY: Number.NaN,
    steering: -8,
    throttle: 9
  }, 2);
  assert.deepEqual(continued, {
    moveX: 1,
    moveY: 0,
    steering: -1,
    throttle: 1,
    source: 'remote'
  });
  assert.equal(Object.isFrozen(continued), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type {InteractionIntentState} from '../shared/protocol/interaction-islands.ts';
import {
  REMOTE_INTENT_DECAY_TICKS,
  REMOTE_INTENT_HOLD_TICKS,
  continuedVehicleIntent
} from '../src/game/network/remote-intent-continuation.ts';

test('remote vehicle intent holds briefly and then decays to neutral', () => {
  const intent = vehicleIntent();

  assert.deepEqual(continuedVehicleIntent(intent, 10), {
    steering: 0.4,
    throttle: 0.5,
    handbrake: true
  });
  assert.deepEqual(continuedVehicleIntent(intent, 10 + REMOTE_INTENT_HOLD_TICKS), {
    steering: 0.4,
    throttle: 0.5,
    handbrake: true
  });
  assert.deepEqual(continuedVehicleIntent(intent, 13), {
    steering: 0.30000000000000004,
    throttle: 0.375,
    handbrake: true
  });
  assert.deepEqual(continuedVehicleIntent(intent, 14), {
    steering: 0.2,
    throttle: 0.25,
    handbrake: true
  });
  assert.deepEqual(continuedVehicleIntent(intent, 15), {
    steering: 0.1,
    throttle: 0.125,
    handbrake: true
  });
  assert.deepEqual(
    continuedVehicleIntent(intent, 10 + REMOTE_INTENT_HOLD_TICKS + REMOTE_INTENT_DECAY_TICKS),
    {steering: 0, throttle: 0}
  );
});

test('remote intent continuation fails neutral for missing, future, and invalid intent', () => {
  assert.deepEqual(continuedVehicleIntent(undefined, 10), {steering: 0, throttle: 0});
  assert.deepEqual(continuedVehicleIntent(vehicleIntent(), 9), {steering: 0, throttle: 0});
  assert.deepEqual(continuedVehicleIntent(vehicleIntent({
    steering: Number.NaN,
    throttle: Number.POSITIVE_INFINITY,
    movementScale: Number.NaN
  }), 10), {steering: 0, throttle: 0});
});

function vehicleIntent(overrides: Partial<InteractionIntentState> = {}): InteractionIntentState {
  return {
    bodyKey: 'vehicle:peer',
    appliedAtServerTick: 10,
    moveX: 0,
    moveY: 0,
    steering: 0.8,
    throttle: 1,
    handbrake: true,
    movementScale: 0.5,
    ...overrides
  };
}

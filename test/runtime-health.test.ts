import assert from 'node:assert/strict';
import test from 'node:test';
import {RuntimeHealthMonitor} from '../server/runtime-health.ts';
import {OnMessageException, SimulationIntervalException} from '@colyseus/core';
import {DistrictRoom} from '../server/district-room.ts';

test('runtime health tracks readiness, fresh ticks, staleness, and stalls', () => {
  const health = new RuntimeHealthMonitor();
  assert.equal(health.isHealthy(1_000), true);
  health.roomReady('district-1', 1_000);
  assert.equal(health.isHealthy(3_000), true);
  assert.equal(health.isHealthy(3_001), false);
  assert.equal(health.shouldFailForStall(6_000), false);
  assert.equal(health.shouldFailForStall(6_001), true);

  health.tickSucceeded(42, undefined, 6_100);
  assert.equal(health.isHealthy(8_100), true);
  assert.equal(health.snapshot(8_100).lastSuccessfulTick, 42);
});

test('runtime health preserves the first fatal context and reports shutdown', () => {
  const health = new RuntimeHealthMonitor();
  health.roomReady('district-1', 1_000);
  health.phaseChanged({id: 'dynamic-contacts', tick: 9});
  assert.equal(health.fail(new Error('physics failed'), 'setSimulationInterval'), true);
  assert.equal(health.fail(new Error('later'), 'watchdog'), false);
  assert.equal(health.isHealthy(1_001), false);
  assert.deepEqual(health.snapshot(1_001).lastFailedPhase, {
    id: 'dynamic-contacts',
    tick: 9
  });
  assert.equal(health.snapshot(1_001).fatalMessage, 'physics failed');
  health.beginShutdown();
  assert.equal(health.snapshot(1_001).shuttingDown, true);
});

test('district room makes simulation failures fatal and isolates message failures', () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const health = new RuntimeHealthMonitor();
    let shutdownError: Error | undefined;
    const room = new DistrictRoom() as any;
    room.runtimeHealth = health;
    room.fatalShutdown = (error: Error) => { shutdownError = error; };
    const cause = new Error('tick failed');
    room.onUncaughtException(
      new SimulationIntervalException(cause, cause.message),
      'setSimulationInterval'
    );
    assert.equal(health.snapshot().fatal, true);
    assert.equal(shutdownError, cause);

    const isolatedHealth = new RuntimeHealthMonitor();
    const isolatedRoom = new DistrictRoom() as any;
    isolatedRoom.runtimeHealth = isolatedHealth;
    isolatedRoom.fatalShutdown = () => assert.fail('message failures must remain isolated');
    const messageCause = new Error('bad message');
    isolatedRoom.onUncaughtException(
      new OnMessageException(messageCause, messageCause.message, {} as never, {}, 'input'),
      'onMessage'
    );
    assert.equal(isolatedHealth.snapshot().fatal, false);
  } finally {
    console.error = originalError;
  }
});

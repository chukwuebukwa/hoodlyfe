import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TrafficDeadlockSystem,
  TRAFFIC_DEADLOCK_TIMING,
  type TrafficDeadlockObservation
} from '../server/game/traffic/traffic-deadlock-system.ts';

test('persistent mutual blockers elect one deterministic recovery owner', () => {
  const first = runMutualBlock(['car-b', 'car-a']);
  const second = runMutualBlock(['car-a', 'car-b']);

  assert.deepEqual(first, second);
  assert.equal(first.ownerId, 'car-a');
  assert.equal(first.command?.blockerId, 'car-b');
  assert.equal(first.command?.cycleSize, 2);
  assert.equal(first.diagnostic.cycleId, 'car-a|car-b');
  assert.equal(first.diagnostic.recovering, true);
  assert.equal(first.diagnostic.recoveryCount, 1);
});

test('deadlock recovery prefers an unreserved vehicle over a junction waiter', () => {
  const system = new TrafficDeadlockSystem();
  for (let nowMs = 0; nowMs <= TRAFFIC_DEADLOCK_TIMING.confirmationMs; nowMs += 1_000) {
    system.observe(observation('queued', 'occupant', nowMs, {junctionPhase: 'waiting'}));
    system.observe(observation('occupant', 'queued', nowMs, {junctionPhase: 'none'}));
    system.beginTick(nowMs);
  }

  assert.equal(system.command('queued', TRAFFIC_DEADLOCK_TIMING.confirmationMs), undefined);
  assert.ok(system.command('occupant', TRAFFIC_DEADLOCK_TIMING.confirmationMs));
});

test('ordinary queues and moving blockers do not become deadlock cycles', () => {
  const system = new TrafficDeadlockSystem();
  for (let nowMs = 0; nowMs <= 8_000; nowMs += 1_000) {
    system.observe(observation('tail', 'leader', nowMs));
    system.observe(observation('leader', '', nowMs, {speedReason: 'signal'}));
    system.observe(observation('moving-a', 'moving-b', nowMs, {speed: 40}));
    system.observe(observation('moving-b', 'moving-a', nowMs, {speed: 40}));
    system.beginTick(nowMs);
  }

  assert.equal(system.command('tail', 8_000), undefined);
  assert.equal(system.command('leader', 8_000), undefined);
  assert.equal(system.diagnostic('tail').cycleSize, 0);
});

test('a cycle waits when every member lacks safe reverse clearance', () => {
  const system = new TrafficDeadlockSystem();
  for (let nowMs = 0; nowMs <= 8_000; nowMs += 1_000) {
    system.observe(observation('car-a', 'car-b', nowMs, {canReverse: false}));
    system.observe(observation('car-b', 'car-a', nowMs, {canReverse: false}));
    system.beginTick(nowMs);
  }

  assert.equal(system.command('car-a', 8_000), undefined);
  assert.equal(system.command('car-b', 8_000), undefined);
  assert.equal(system.diagnostic('car-a').cycleSize, 2);
});

test('recovery commands expire and do not immediately retrigger during cooldown', () => {
  const system = new TrafficDeadlockSystem();
  const confirmation = TRAFFIC_DEADLOCK_TIMING.confirmationMs;
  for (let nowMs = 0; nowMs <= confirmation; nowMs += 1_000) {
    system.observe(observation('car-a', 'car-b', nowMs));
    system.observe(observation('car-b', 'car-a', nowMs));
    system.beginTick(nowMs);
  }
  assert.ok(system.command('car-a', confirmation));

  const expiredAt = confirmation + TRAFFIC_DEADLOCK_TIMING.recoveryDurationMs;
  system.observe(observation('car-a', 'car-b', expiredAt));
  system.observe(observation('car-b', 'car-a', expiredAt));
  system.beginTick(expiredAt);
  assert.equal(system.command('car-a', expiredAt), undefined);
  assert.equal(system.command('car-b', expiredAt), undefined);
  assert.equal(system.diagnostic('car-a').recoveryCount, 1);
});

function runMutualBlock(order: readonly string[]): {
  ownerId: string;
  command: ReturnType<TrafficDeadlockSystem['command']>;
  diagnostic: ReturnType<TrafficDeadlockSystem['diagnostic']>;
} {
  const system = new TrafficDeadlockSystem();
  for (let nowMs = 0; nowMs <= TRAFFIC_DEADLOCK_TIMING.confirmationMs; nowMs += 1_000) {
    for (const vehicleId of order) {
      system.observe(observation(vehicleId, vehicleId === 'car-a' ? 'car-b' : 'car-a', nowMs));
    }
    system.beginTick(nowMs);
  }
  const ownerId = ['car-a', 'car-b'].find((vehicleId) => (
    system.command(vehicleId, TRAFFIC_DEADLOCK_TIMING.confirmationMs)
  ))!;
  return {
    ownerId,
    command: system.command(ownerId, TRAFFIC_DEADLOCK_TIMING.confirmationMs),
    diagnostic: system.diagnostic(ownerId)
  };
}

function observation(
  vehicleId: string,
  obstacleId: string,
  observedAt: number,
  overrides: Partial<TrafficDeadlockObservation> = {}
): TrafficDeadlockObservation {
  return {
    vehicleId,
    obstacleId,
    speedReason: 'vehicle',
    speed: 0,
    junctionPhase: 'none',
    canReverse: true,
    observedAt,
    ...overrides
  };
}

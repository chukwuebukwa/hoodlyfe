import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SimulationObservability,
  type SimulationObservabilitySink,
  type SimulationObservationInput
} from '../server/game/observability/simulation-observability.ts';

class MemorySink implements SimulationObservabilitySink {
  readonly values: unknown[] = [];
  closed = false;

  append(value: unknown): void {
    this.values.push(value);
  }

  close(): void {
    this.closed = true;
  }
}

const observation = (
  tick: number,
  durationMs: number,
  droppedMs = 0
): SimulationObservationInput => ({
  tick,
  nowMs: tick * 1000 / 60,
  droppedMs,
  eventsThisTick: 2,
  entities: {
    players: 1,
    npcs: 20,
    vehicles: 10,
    bullets: 3,
    rockets: 0,
    thrownProjectiles: 0,
    explosions: 0,
    fires: 0
  },
  phases: [{
    id: 'projectiles',
    order: 0,
    runs: tick,
    lastTick: tick,
    lastDurationMs: durationMs,
    maxDurationMs: durationMs,
    failures: 0
  }],
  vehicleMotion: {
    beginTickMs: 0.1,
    slowestVehicle: {id: 'vehicle-2', kind: 'police', durationMs: 12}
  }
});

test('simulation observability writes 1 Hz samples and immediate hitches', () => {
  const sink = new MemorySink();
  const observability = new SimulationObservability({
    roomId: 'room-1',
    buildId: 'build-1',
    journalFile: 'district-room-1.jsonl',
    stepMs: 1000 / 60,
    sampleIntervalTicks: 60,
    sink,
    now: () => new Date('2026-07-23T00:00:00.000Z')
  });

  assert.equal(observability.observe(observation(59, 2)), undefined);
  assert.equal(observability.observe(observation(60, 2))?.kind, 'sample');
  assert.equal(observability.observe(observation(61, 18))?.kind, 'hitch');
  assert.equal(observability.observe(observation(62, 2, 5))?.kind, 'hitch');

  const snapshot = observability.snapshot();
  assert.equal(snapshot.latest?.tick, 62);
  assert.equal(snapshot.latest?.droppedDeltaMs, 5);
  assert.deepEqual(snapshot.latest?.slowestPhase, {id: 'projectiles', durationMs: 2});
  assert.deepEqual(snapshot.latest?.vehicleMotion?.slowestVehicle, {
    id: 'vehicle-2', kind: 'police', durationMs: 12
  });
  assert.deepEqual(sink.values.map((value) => (value as {kind?: string}).kind), [
    'observability.header',
    'sample',
    'hitch',
    'hitch'
  ]);
  observability.close();
  assert.equal(sink.closed, true);
});

test('simulation observability disables only its failing sink', () => {
  let failures = 0;
  const observability = new SimulationObservability({
    roomId: 'room-1',
    buildId: 'build-1',
    stepMs: 1000 / 60,
    sampleIntervalTicks: 60,
    sink: {
      append: () => { throw new Error('disk full'); },
      close: () => undefined
    },
    onFailure: () => { failures++; }
  });

  assert.doesNotThrow(() => observability.observe(observation(60, 2)));
  assert.equal(failures, 1);
  assert.equal(observability.snapshot().latest?.kind, 'sample');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {RemoteMotionTimeline} from '../src/game/network/remote-motion-timeline.ts';

test('remote timeline interpolates timestamped position and shortest wrapped heading', () => {
  const timeline = new RemoteMotionTimeline();
  timeline.push({timeMs: 100, x: 0, y: 10, angle: Math.PI - 0.1});
  timeline.push({timeMs: 200, x: 100, y: 30, angle: -Math.PI + 0.1});
  const sample = timeline.sample(150, 220)!;
  assert.deepEqual({x: sample.x, y: sample.y}, {x: 50, y: 20});
  assert.ok(Math.abs(Math.abs(sample.angle) - Math.PI) < 0.001);
  assert.equal(sample.mode, 'interpolated');
  assert.equal(sample.snapshotAgeMs, 20);
  assert.equal(sample.bufferUnderrun, false);
});

test('remote timeline extrapolates briefly, caps velocity, then holds and reports underrun', () => {
  const timeline = new RemoteMotionTimeline({
    maximumExtrapolationMs: 100,
    maximumExtrapolationSpeed: 200
  });
  timeline.push({timeMs: 100, x: 0, y: 0, angle: 0});
  timeline.push({timeMs: 200, x: 100, y: 0, angle: 0});
  const extrapolated = timeline.sample(250, 270)!;
  assert.equal(extrapolated.mode, 'extrapolated');
  assert.equal(extrapolated.x, 110);
  assert.equal(extrapolated.extrapolationMs, 50);
  assert.equal(extrapolated.bufferUnderrun, false);

  const held = timeline.sample(350, 370)!;
  assert.equal(held.mode, 'held');
  assert.equal(held.x, 100);
  assert.equal(held.extrapolationMs, 150);
  assert.equal(held.bufferUnderrun, true);
  assert.equal(held.snapshotAgeMs, 170);
});

test('remote timeline rejects hostile state and clears history across teleports or long gaps', () => {
  const timeline = new RemoteMotionTimeline({teleportDistance: 100, maximumSnapshotGapMs: 300});
  assert.equal(timeline.push({timeMs: 100, x: 0, y: 0, angle: 0}), true);
  assert.equal(timeline.push({timeMs: 90, x: 1, y: 1, angle: 0}), false);
  assert.equal(timeline.push({timeMs: 110, x: Number.NaN, y: 0, angle: 0}), false);
  timeline.push({timeMs: 200, x: 200, y: 0, angle: 1});
  assert.equal(timeline.size(), 1);
  const teleported = timeline.sample(200, 200)!;
  assert.equal(teleported.mode, 'teleported');
  assert.equal(teleported.x, 200);

  timeline.push({timeMs: 600, x: 201, y: 0, angle: 1});
  assert.equal(timeline.size(), 1);
  assert.equal(timeline.sample(500, 600)?.bufferUnderrun, true);
});

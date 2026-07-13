import assert from 'node:assert/strict';
import test from 'node:test';
import {MotionSnapshotBuffer} from '../src/game/network/motion-snapshot-buffer.ts';

test('motion snapshots interpolate timestamped position and shortest wrapped heading', () => {
  const buffer = new MotionSnapshotBuffer();
  buffer.push({timeMs: 100, x: 0, y: 10, angle: Math.PI - 0.1});
  buffer.push({timeMs: 200, x: 100, y: 30, angle: -Math.PI + 0.1});
  const sample = buffer.sample(150)!;
  assert.deepEqual({x: sample.x, y: sample.y}, {x: 50, y: 20});
  assert.ok(Math.abs(Math.abs(sample.angle) - Math.PI) < 0.001);
});

test('motion snapshots reject stale samples and snap teleports', () => {
  const buffer = new MotionSnapshotBuffer();
  buffer.push({timeMs: 100, x: 0, y: 0, angle: 0});
  buffer.push({timeMs: 90, x: 50, y: 50, angle: 1});
  buffer.push({timeMs: 200, x: 400, y: 0, angle: 1});
  assert.equal(buffer.sample(150)?.x, 400);
});

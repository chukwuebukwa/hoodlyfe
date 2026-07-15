import assert from 'node:assert/strict';
import test from 'node:test';
import {RemoteMotionTimeline} from '../src/game/network/remote-motion-timeline.ts';
import {adaptiveInterpolationDelayMs} from '../src/game/network/remote-timeline-policy.ts';
import {
  DeterministicReliableNetworkLink,
  NETWORK_IMPAIRMENT_PROFILES,
  type NetworkImpairmentProfile
} from './support/deterministic-network-link.ts';

interface TimelineRun {
  profile: NetworkImpairmentProfile;
  interpolationDelayMs: number;
  errorP95: number;
  maximumError: number;
  underrunPercent: number;
  extrapolationPercent: number;
  maximumBufferSize: number;
}

const STEP_MS = 1_000 / 30;
const SNAPSHOT_INTERVAL_TICKS = 2;
const TOTAL_TICKS = 600;
const WARMUP_TICKS = 60;

test('adaptive remote timelines remain bounded across repeatable network impairment', (context) => {
  const runs = NETWORK_IMPAIRMENT_PROFILES.map((profile, index) => runProfile(profile, index));
  for (const run of runs) {
    context.diagnostic(
      `${run.profile.id}: delay=${run.interpolationDelayMs.toFixed(1)}ms ` +
      `p95=${run.errorP95.toFixed(2)}px max=${run.maximumError.toFixed(2)}px ` +
      `under=${run.underrunPercent.toFixed(1)}% extra=${run.extrapolationPercent.toFixed(1)}%`
    );
    assert.ok(run.errorP95 < 12, `${run.profile.id} exceeded remote-motion p95 error.`);
    assert.ok(run.maximumError < 85, `${run.profile.id} exceeded bounded hold error.`);
    assert.ok(run.underrunPercent < 8, `${run.profile.id} exhausted its adaptive buffer too often.`);
    assert.ok(run.maximumBufferSize <= 32, `${run.profile.id} exceeded retained timeline history.`);
  }
  assert.equal(runs[0].underrunPercent, 0);
  assert.ok(runs.at(-1)!.interpolationDelayMs > runs[0].interpolationDelayMs);
});

test('remote timeline impairment metrics are deterministic', () => {
  const profile = NETWORK_IMPAIRMENT_PROFILES.at(-1)!;
  assert.deepEqual(runProfile(profile, 91), runProfile(profile, 91));
});

function runProfile(profile: NetworkImpairmentProfile, seed: number): TimelineRun {
  const link = new DeterministicReliableNetworkLink<ReturnType<typeof poseAt>>(
    profile,
    0x712000 + seed
  );
  const timeline = new RemoteMotionTimeline({
    teleportDistance: 320,
    maximumExtrapolationMs: 100,
    maximumExtrapolationSpeed: 500
  });
  const patchGapP95Ms = STEP_MS * SNAPSHOT_INTERVAL_TICKS;
  const interpolationDelayMs = adaptiveInterpolationDelayMs({
    patchGapP95Ms,
    jitterP95Ms: profile.jitterMs,
    rttMedianMs: profile.roundTripTimeMs,
    rttP95Ms: profile.roundTripTimeMs
  });
  const errors: number[] = [];
  let underruns = 0;
  let extrapolations = 0;
  let samples = 0;
  let maximumBufferSize = 0;
  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    const nowMs = tick * STEP_MS;
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0) link.send(nowMs, poseAt(nowMs));
    for (const snapshot of link.receive(nowMs)) timeline.push(snapshot);
    maximumBufferSize = Math.max(maximumBufferSize, timeline.size());
    const renderTimeMs = Math.max(0, nowMs - interpolationDelayMs);
    const sample = timeline.sample(renderTimeMs, nowMs);
    if (!sample || tick <= WARMUP_TICKS) continue;
    const expected = poseAt(renderTimeMs);
    errors.push(Math.hypot(sample.x - expected.x, sample.y - expected.y));
    if (sample.bufferUnderrun) underruns++;
    if (sample.mode === 'extrapolated') extrapolations++;
    samples++;
  }
  errors.sort((left, right) => left - right);
  return {
    profile,
    interpolationDelayMs,
    errorP95: percentile(errors, 0.95),
    maximumError: errors.at(-1) ?? 0,
    underrunPercent: percentage(underruns, samples),
    extrapolationPercent: percentage(extrapolations, samples),
    maximumBufferSize
  };
}

function poseAt(timeMs: number) {
  const timeSeconds = timeMs / 1_000;
  const angularSpeed = 0.34;
  const phase = timeSeconds * angularSpeed;
  const radiusX = 420;
  const radiusY = 260;
  const velocityX = -Math.sin(phase) * radiusX * angularSpeed;
  const velocityY = Math.cos(phase) * radiusY * angularSpeed;
  return {
    timeMs,
    x: 2_000 + Math.cos(phase) * radiusX,
    y: 2_000 + Math.sin(phase) * radiusY,
    angle: Math.atan2(velocityY, velocityX),
    velocityX,
    velocityY
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function percentage(count: number, total: number): number {
  return total > 0 ? Math.round(count / total * 1_000) / 10 : 0;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptiveInterpolationDelayMs,
  DEFAULT_INTERPOLATION_DELAY_MS,
  MAXIMUM_INTERPOLATION_DELAY_MS,
  MINIMUM_INTERPOLATION_DELAY_MS,
  shouldUseRemoteTimeline
} from '../src/game/network/remote-timeline-policy.ts';

test('remote timelines exclude the local player and locally occupied vehicle', () => {
  assert.equal(shouldUseRemoteTimeline('local', 'local'), false);
  assert.equal(shouldUseRemoteTimeline('car-1', 'car-1'), false);
  assert.equal(shouldUseRemoteTimeline('remote', 'local'), true);
});

test('adaptive timeline delay covers patch cadence, jitter, and RTT variation within bounds', () => {
  assert.equal(adaptiveInterpolationDelayMs({
    patchGapP95Ms: 0,
    jitterP95Ms: 0,
    rttMedianMs: 0,
    rttP95Ms: 0
  }), DEFAULT_INTERPOLATION_DELAY_MS);
  assert.equal(adaptiveInterpolationDelayMs({
    patchGapP95Ms: 40,
    jitterP95Ms: 0,
    rttMedianMs: 30,
    rttP95Ms: 30
  }), MINIMUM_INTERPOLATION_DELAY_MS);
  assert.equal(adaptiveInterpolationDelayMs({
    patchGapP95Ms: 80,
    jitterP95Ms: 0,
    rttMedianMs: 80,
    rttP95Ms: 80
  }), 120);
  assert.equal(adaptiveInterpolationDelayMs({
    patchGapP95Ms: 67,
    jitterP95Ms: 35,
    rttMedianMs: 250,
    rttP95Ms: 250
  }), 195);
  assert.equal(adaptiveInterpolationDelayMs({
    patchGapP95Ms: 120,
    jitterP95Ms: 90,
    rttMedianMs: 100,
    rttP95Ms: 300
  }), MAXIMUM_INTERPOLATION_DELAY_MS);
});

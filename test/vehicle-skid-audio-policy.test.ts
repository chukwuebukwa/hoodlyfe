import assert from 'node:assert/strict';
import test from 'node:test';
import {vehicleSkidAudioPresentation} from '../src/game/audio/vehicle-skid-audio-policy.ts';

test('skid audio requires speed and lateral slip', () => {
  const rolling = vehicleSkidAudioPresentation({
    angle: 0,
    linvelX: 220,
    linvelY: 0
  });
  const sliding = vehicleSkidAudioPresentation({
    angle: 0,
    linvelX: 180,
    linvelY: 110
  });
  const slowSlide = vehicleSkidAudioPresentation({
    angle: 0,
    linvelX: 35,
    linvelY: 30
  });

  assert.equal(rolling.active, false);
  assert.equal(sliding.active, true);
  assert.ok(sliding.intensity > 0);
  assert.equal(slowSlide.active, false);
});

test('destroyed vehicles cannot produce skid audio', () => {
  const presentation = vehicleSkidAudioPresentation({
    angle: 0,
    linvelX: 180,
    linvelY: 110,
    destroyed: true
  });
  assert.equal(presentation.active, false);
});

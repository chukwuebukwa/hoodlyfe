import assert from 'node:assert/strict';
import test from 'node:test';
import {voiceIndicatorPresentation} from '../src/game/rendering/voice-indicator-policy.ts';

test('voice indicator is hidden without speech activity', () => {
  assert.deepEqual(voiceIndicatorPresentation(0, 500), {
    visible: false,
    scale: 0.92,
    opacity: 0
  });
});

test('voice indicator responds smoothly to voice activity', () => {
  const quiet = voiceIndicatorPresentation(0.1, 0);
  const loud = voiceIndicatorPresentation(0.9, 0);
  assert.equal(quiet.visible, true);
  assert.equal(loud.visible, true);
  assert.ok(loud.scale > quiet.scale);
  assert.ok(loud.opacity > quiet.opacity);
  assert.ok(loud.opacity <= 1);
});

test('voice indicator clamps invalid activity levels', () => {
  assert.equal(voiceIndicatorPresentation(-1, 0).visible, false);
  assert.equal(
    voiceIndicatorPresentation(2, 0).opacity,
    voiceIndicatorPresentation(1, 0).opacity
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLOR_VALUES,
  DEFAULT_APPEARANCE,
  SKIN_COLORS,
  cloneAppearance
} from '../shared/content/appearance-catalog.ts';
import {
  appearancePixelColor,
  appearanceSpritePresentation
} from '../src/game/appearance/appearance-render-policy.ts';

test('appearance presentation keeps body choice visual-only and texture identity stable', () => {
  const standard = appearanceSpritePresentation(cloneAppearance());
  const slim = appearanceSpritePresentation({...cloneAppearance(), bodyType: 'slim'});
  const broad = appearanceSpritePresentation({...cloneAppearance(), bodyType: 'broad'});
  assert.equal(standard.bodyScaleX, 1);
  assert.ok(slim.bodyScaleX < 1);
  assert.ok(broad.bodyScaleX > 1);
  assert.notEqual(slim.textureKey, broad.textureKey);
  assert.match(standard.animationKey, /^driver-walk:/);
});

test('palette policy maps skin, top, bottom, and shoe zones to separate colors', () => {
  const appearance = {...DEFAULT_APPEARANCE, topColor: 'red' as const, bottomColor: 'blue' as const};
  const skin = appearancePixelColor(180, 110, 70, 36, 20, appearance);
  const top = appearancePixelColor(150, 150, 150, 36, 30, appearance);
  const bottom = appearancePixelColor(150, 150, 150, 36, 39, appearance);
  const shoe = appearancePixelColor(150, 150, 150, 36, 46, appearance);
  assert.ok(skin !== undefined && (skin >> 16) <= (SKIN_COLORS[appearance.skinTone] >> 16));
  assert.ok(top !== undefined && ((top >> 16) & 0xff) > ((top >> 8) & 0xff));
  assert.ok(bottom !== undefined && (bottom & 0xff) > ((bottom >> 16) & 0xff));
  assert.ok(shoe !== undefined && shoe !== COLOR_VALUES.charcoal);
  assert.equal(appearancePixelColor(5, 5, 5, 36, 30, appearance), undefined);
});

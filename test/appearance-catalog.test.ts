import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPEARANCE_COLORS,
  BODY_TYPES,
  DEFAULT_APPEARANCE,
  SKIN_TONES,
  appearanceTextureKey,
  cloneAppearance,
  validateAppearance
} from '../shared/content/appearance-catalog.ts';

test('appearance catalog validates finite stable IDs and canonicalizes outfit names', () => {
  const valid = validateAppearance({...DEFAULT_APPEARANCE, outfitName: '  Night  Run!  '});
  assert.ok(valid);
  assert.equal(valid.outfitName, 'Night Run');
  assert.equal(validateAppearance({...DEFAULT_APPEARANCE, bodyType: 'giant'}), undefined);
  assert.equal(validateAppearance({...DEFAULT_APPEARANCE, topColor: '#ffffff'}), undefined);
  assert.equal(validateAppearance({...DEFAULT_APPEARANCE, outfitName: '!!!'}), undefined);
  assert.equal(validateAppearance(null), undefined);
  assert.ok(BODY_TYPES.length >= 3);
  assert.ok(SKIN_TONES.length >= 6);
  assert.ok(APPEARANCE_COLORS.length >= 10);
});

test('appearance texture identity excludes mutable outfit display name', () => {
  const first = cloneAppearance();
  const second = {...first, outfitName: 'Another Name'};
  assert.equal(appearanceTextureKey(first), appearanceTextureKey(second));
  second.topColor = 'red';
  assert.notEqual(appearanceTextureKey(first), appearanceTextureKey(second));
  assert.notStrictEqual(cloneAppearance(), DEFAULT_APPEARANCE);
});

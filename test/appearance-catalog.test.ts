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
import {
  DEFAULT_LPC_RECIPE,
  lpcAssetCandidates,
  lpcLayerDefinitions,
  parseLpcRecipe,
  serializeLpcRecipe
} from '../shared/content/lpc-character-catalog.ts';

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

test('appearance catalog preserves valid LPC recipe payloads only', () => {
  const lpcRecipe = serializeLpcRecipe({...DEFAULT_LPC_RECIPE, hair: 'afro'});
  const valid = validateAppearance({...DEFAULT_APPEARANCE, lpcRecipe});
  assert.equal(valid?.lpcRecipe, lpcRecipe);
  assert.equal(validateAppearance({...DEFAULT_APPEARANCE, lpcRecipe: '{"version":999}'})?.lpcRecipe, '');
});

test('LPC recipes migrate missing hair color and prefer colored fallback assets', () => {
  const legacy = parseLpcRecipe(JSON.stringify({
    version: 1,
    name: 'LPC Driver',
    body: 'male',
    face: 'anger',
    hair: 'afro',
    top: 'longsleeve',
    legs: 'formal_striped',
    shoes: 'boots',
    topColor: 'brown',
    legsColor: 'navy',
    shoesColor: 'navy'
  }));
  assert.equal(legacy?.hairColor, 'orange');
  assert.equal(legacy?.top, 'longsleeve');
  const topLayer = lpcLayerDefinitions(legacy!).find((layer) => layer.id === 'top');
  assert.ok(topLayer);
  assert.deepEqual(lpcAssetCandidates(topLayer, 'idle').slice(0, 3), [
    '/assets/custom/lpc-catalog/spritesheets/torso/clothes/longsleeve/laced/male/idle/brown.png',
    '/assets/custom/lpc-catalog/spritesheets/torso/clothes/longsleeve/laced/male/walk/brown.png',
    '/assets/custom/lpc-catalog/spritesheets/torso/clothes/longsleeve/laced/male/idle.png'
  ]);

  const custom = parseLpcRecipe(serializeLpcRecipe({...DEFAULT_LPC_RECIPE, top: 'smiley', topColor: 'red'}));
  assert.equal(custom?.top, 'smiley');
  const customTopLayer = lpcLayerDefinitions(custom!).find((layer) => layer.id === 'top');
  assert.ok(customTopLayer);
  assert.deepEqual(lpcAssetCandidates(customTopLayer, 'idle').slice(0, 2), [
    '/assets/custom/lpc-catalog/spritesheets/torso/clothes/custom/smiley_tee/male/idle.png',
    '/assets/custom/lpc-catalog/spritesheets/torso/clothes/custom/smiley_tee/male/walk.png'
  ]);

  const hatRecipe = parseLpcRecipe(serializeLpcRecipe({...DEFAULT_LPC_RECIPE, hat: 'cavalier', hatColor: 'maroon'}));
  assert.equal(hatRecipe?.hat, 'cavalier');
  const hatLayer = lpcLayerDefinitions(hatRecipe!).find((layer) => layer.id === 'hat');
  assert.ok(hatLayer);
  assert.deepEqual(lpcAssetCandidates(hatLayer, 'idle').slice(0, 2), [
    '/assets/custom/lpc-catalog/spritesheets/hat/pirate/cavalier/adult/idle/maroon.png',
    '/assets/custom/lpc-catalog/spritesheets/hat/pirate/cavalier/adult/walk/maroon.png'
  ]);

  const timbsRecipe = parseLpcRecipe(serializeLpcRecipe({...DEFAULT_LPC_RECIPE, shoes: 'timbs', shoesColor: 'blue'}));
  assert.equal(timbsRecipe?.shoes, 'timbs');
  const timbsLayer = lpcLayerDefinitions(timbsRecipe!).find((layer) => layer.id === 'shoes');
  assert.ok(timbsLayer);
  assert.deepEqual(lpcAssetCandidates(timbsLayer, 'idle').slice(0, 2), [
    '/assets/custom/lpc-catalog/spritesheets/feet/boots/custom/timbs/male/idle.png',
    '/assets/custom/lpc-catalog/spritesheets/feet/boots/custom/timbs/male/walk.png'
  ]);

  const yarmulkeRecipe = parseLpcRecipe(serializeLpcRecipe({...DEFAULT_LPC_RECIPE, hat: 'yarmulke', hatColor: 'red'}));
  assert.equal(yarmulkeRecipe?.hat, 'yarmulke');
  const yarmulkeLayer = lpcLayerDefinitions(yarmulkeRecipe!).find((layer) => layer.id === 'hat');
  assert.ok(yarmulkeLayer);
  assert.deepEqual(lpcAssetCandidates(yarmulkeLayer, 'idle').slice(0, 2), [
    '/assets/custom/lpc-catalog/spritesheets/hat/custom/yarmulke/adult/idle.png',
    '/assets/custom/lpc-catalog/spritesheets/hat/custom/yarmulke/adult/walk.png'
  ]);
});

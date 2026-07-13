import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';
import {
  CHARACTER_ATLASES,
  CHARACTER_CLIPS,
  characterClipFrame,
  characterClipProgressFrame
} from '../shared/content/character-animation-manifest.ts';
import {CHARACTER_PARTS} from '../shared/content/character-part-catalog.ts';
import {WARDROBE_ITEMS} from '../shared/content/wardrobe-catalog.ts';
import {
  characterMaterialRole,
  compiledCharacterKey,
  materialColor
} from '../src/game/appearance/character-sprite-compiler.ts';

test('animation manifest keeps every semantic frame inside its declared atlas', () => {
  for (const clip of Object.values(CHARACTER_CLIPS)) {
    const atlas = CHARACTER_ATLASES[clip.atlas];
    assert.ok(clip.frames.length > 0);
    assert.ok(clip.frames.every((frame) => frame >= 0 && frame < atlas.columns * atlas.rows));
  }
  assert.equal(characterClipFrame('walk', 0), 1);
  assert.equal(characterClipFrame('walk', 105), 2);
  assert.equal(characterClipFrame('dead', 50_000), 7);
  assert.equal(characterClipProgressFrame('melee', 0.74), 2);
  assert.equal(characterClipProgressFrame('vehicleEnter', 0.99), 11);
});

test('every wardrobe item has a versioned body-compatible character part definition', () => {
  assert.deepEqual(
    CHARACTER_PARTS.map((part) => part.id).sort(),
    WARDROBE_ITEMS.map((part) => part.id).sort()
  );
  for (const part of CHARACTER_PARTS) {
    assert.deepEqual(part.bodyFamilies, ['standard-01']);
    assert.equal(part.renderMode, 'procedural-fallback');
    assert.ok(part.clips.includes('walk'));
    assert.ok(part.clips.includes('dead'));
  }
});

test('material masks resolve stable semantic channels and appearance-specific output keys', () => {
  assert.equal(characterMaterialRole(255, 0, 0), 'skin');
  assert.equal(characterMaterialRole(128, 64, 0), 'hair');
  assert.equal(characterMaterialRole(0, 255, 0), 'primary');
  assert.equal(characterMaterialRole(0, 96, 255), 'secondary');
  assert.equal(characterMaterialRole(255, 0, 255), 'shoes');
  assert.equal(characterMaterialRole(0, 0, 0), undefined);
  const first = cloneAppearance();
  const second = {...first, topColor: 'red' as const};
  assert.notEqual(compiledCharacterKey(first), compiledCharacterKey(second));
  assert.notEqual(materialColor('primary', first, 0.8), materialColor('primary', second, 0.8));
});

for (const [name, width, height] of [
  ['../base/walk.png', 216, 216],
  ['walk-materials.png', 216, 216],
  ['actions-materials.png', 288, 216]
] as const) {
  test(`${name} keeps the compiler mask contract`, async () => {
    const png = await readFile(new URL(
      `../public/assets/custom/characters/standard-01/masks/${name}`,
      import.meta.url
    ));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.equal(png[25], 6);
  });
}

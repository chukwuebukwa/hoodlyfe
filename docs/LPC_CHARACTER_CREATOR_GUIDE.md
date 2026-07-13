# LPC Character Creator Guide

This guide documents the current NOCK0 LPC character creator pipeline: how recipes are edited, how custom LPC-compatible items are generated, how the in-game Threads store applies a character, and what must be preserved when extending it.

## Current Architecture

NOCK0 stores a character as a small LPC recipe JSON string, not as generated sprite PNGs.

The recipe lives in `PlayerAppearance.lpcRecipe` and contains stable content IDs:

```json
{
  "version": 1,
  "name": "LPC Driver",
  "body": "male",
  "face": "neutral",
  "hair": "pixie",
  "hat": "yarmulke",
  "top": "smiley",
  "legs": "formal_striped",
  "shoes": "timbs",
  "hairColor": "orange",
  "hatColor": "black",
  "topColor": "white",
  "legsColor": "navy",
  "shoesColor": "black"
}
```

The browser compiles that recipe into runtime atlases with `compileLpcCharacterSpriteSet`. Other players receive only the replicated recipe string through Colyseus and compile the same result locally.

## Important Files

- `shared/content/lpc-character-catalog.ts`
  Owns the recipe schema, finite option IDs, layer order, color palette, asset path resolution, and validation.

- `src/game/appearance/lpc-character-sprite-compiler.ts`
  Loads the generated LPC catalog manifest, composites recipe layers, applies hair tint, and produces NOCK0-compatible `72px` walk/action atlases.

- `scripts/import-lpc-catalog.py`
  Copies the curated Universal LPC source layers into `public/assets/custom/lpc-catalog/` and generates custom fixed-color items.

- `creator.html` and `src/creator-main.ts`
  Standalone development lab for inspecting recipes, animations, frames, exports, and custom items.

- `src/game/appearance/appearance-creator-controller.ts`
  In-game LPC creator used by Threads/wardrobe. It edits an LPC recipe and submits it through the existing appearance update flow.

- `src/game/three/three-district-entities.ts`
  Parses `player.appearance.lpcRecipe`, compiles/caches the LPC atlas, and uses it for Three player rendering.

## Runtime Flow

1. Player opens Threads.
2. Server sends the existing wardrobe open message.
3. Client opens the LPC creator modal.
4. Player edits the recipe.
5. On apply, the client sends:

```ts
wardrobeSession.submit({
  ...currentAppearance,
  outfitName: recipe.name,
  lpcRecipe: serializeLpcRecipe(recipe)
});
```

6. Server validates the public appearance payload and assigns `lpcRecipe` to `PlayerAppearanceState`.
7. Colyseus replicates equipped appearance to all clients.
8. Each client compiles the recipe locally and caches by the serialized recipe key.
9. Local storage also saves the chosen appearance for reload convenience.

## Storage Rules

Store recipes, not generated images.

Allowed:

- `lpcRecipe`
- `lpcRecipeHash`
- future named outfit records that contain recipe JSON

Avoid:

- storing generated walk/action PNGs
- storing raw canvas data
- storing source asset paths as player-owned state

Generated sprite sheets are deterministic build/runtime artifacts. The durable player identity should be content IDs and color IDs.

## LPC Layer Contract

Every selectable visual item must provide aligned LPC sheets for the animations NOCK0 currently compiles:

- `idle`
- `walk`
- `slash`
- `hurt`
- `sit`

Each sheet must use:

- `64px` LPC source frames
- shared LPC direction rows where available
- transparent background
- the same character origin as the LPC body
- no arbitrary per-frame canvas resizing

NOCK0 converts the composed LPC output into:

- walk atlas: `72px`, `9 x 4`
- action atlas: `72px`, `4 x 3`

## Custom Item Pipeline

Custom items are generated in `scripts/import-lpc-catalog.py`, then written into `public/assets/custom/lpc-catalog/`.

Run:

```bash
python3 scripts/import-lpc-catalog.py
```

The generated catalog also writes `manifest.json`, which the browser loader uses to fetch all available source sheets.

Current custom items:

- `Smiley Tee`
  Generated from an LPC shirt base with a fixed chest decal.

- `Puffer Jacket`
  Generated from LPC long-sleeve torso sheets for male/thin bodies. The importer preserves the source alpha and frame alignment, then emits per-color variant sheets under `custom/puffer/.../{animation}/{color}.png` so the normal `topColor` swatches stay enabled.

- `Timbs`
  Generated from LPC boot frames, recolored as wheat boots with darker collar/sole pixels.

- `Yarmulke`
  Generated as a transparent custom hat layer. Its position is derived from the source head alpha bounds per frame so it follows walk/animation bobbing.

## Adding A New Custom Shirt

1. Pick the closest LPC source layer, usually under `spritesheets/torso/clothes/...`.
2. Add a generator function in `scripts/import-lpc-catalog.py`.
3. Generate every required animation sheet.
4. Keep artwork masked to existing clothing pixels unless the item intentionally extends silhouette.
5. Add a new `LpcTopId` and option in `lpc-character-catalog.ts`.
6. Return a custom fixed layer from `layerForTop`.
7. Disable or ignore color swatches if the item is fixed-color.
8. Add a regression test for `lpcAssetCandidates`.

For colorable custom shirts, generate the same variant layout as LPC color assets:

```text
spritesheets/torso/clothes/custom/<item>/<shape>/<animation>/<color>.png
```

Then return a layer with `variant: recipe.topColor`. The puffer jacket follows this path, so it works with the existing material controls instead of custom UI.

## Adding Custom Shoes

Shoes are tiny at LPC scale, so use material remapping more than detail drawing.

For fixed-color footwear:

1. Start from an LPC footwear source sheet.
2. Repaint nontransparent pixels into the desired material palette.
3. Add only very small highlights/laces/sole pixels.
4. Add the option to `LPC_SHOE_OPTIONS`.
5. Return a fixed path from `layerForShoes`.
6. Disable `shoesColor` when selected.

## Adding Custom Hats

Hats must follow head motion. Do not place the item at one static coordinate.

For small headwear:

1. Load the LPC head sheet for the current animation.
2. For each frame, find the head alpha bounds.
3. Place the hat relative to those bounds.
4. Generate a transparent hat-only sheet.
5. Add the option to `LPC_HAT_OPTIONS`.
6. Return a fixed or colorable hat layer from `hatLayers`.

The yarmulke uses this approach so it follows the walk bob.

## Color Rules

Colorable LPC assets use variant files like:

```text
spritesheets/.../walk/brown.png
```

Fixed custom assets use:

```text
spritesheets/.../walk.png
```

For fixed-color items, the creator disables the relevant swatches:

- `Smiley Tee` disables `topColor`
- `Timbs` disables `shoesColor`
- fixed hats disable `hatColor`

Hair is special: the current compiler tints fixed LPC hair sheets at runtime using `hairColor`.

## In-Game Threads Integration

Threads should open the LPC creator, not the old paint-over creator.

The in-game controller:

- creates the modal DOM at runtime
- loads the LPC source manifest
- previews the compiled walk animation
- sends normal `appearance.update`
- saves accepted looks to local storage
- blocks movement/aim while open

The Three route wires this through `ThreeDistrictUiController`, because the Three renderer has its own UI/input path.

## Testing

Useful focused checks:

```bash
npx tsx --test test/appearance-catalog.test.ts test/player-appearance-controller.test.ts test/wardrobe-client-session.test.ts
npm run build
```

Use `python3 scripts/import-lpc-catalog.py` after changing imported/generated LPC assets.

## Known Gaps

- Persistence is currently local/session-based. Durable account storage should save `lpcRecipe` and named outfit records.
- The catalog is curated, not the full LPC universe.
- LPC art remains a four-direction RPG perspective. It is good enough for the current prototype, but not a perfect NOCK0 top-down action match.
- Weapon-held poses are still handled by NOCK0's rotating weapon sprite, not LPC hand-authored weapon poses.
- Custom assets need proper attribution/licensing review before production use.

## Durable Persistence Target

When accounts exist, store something like:

```json
{
  "playerId": "player_123",
  "activeOutfitId": "outfit_main",
  "outfits": [
    {
      "id": "outfit_main",
      "name": "LPC Driver",
      "lpcRecipe": "{\"version\":1,...}",
      "lpcRecipeHash": "LPC-4975E340",
      "updatedAt": "2026-07-11T09:44:57.000Z"
    }
  ]
}
```

The renderer should continue compiling from the recipe. Durable storage should not depend on generated sprite files.

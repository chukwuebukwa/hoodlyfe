# Character Sprite Pipeline

The character system compiles one validated `PlayerAppearance` recipe into a paired walk/action
texture set. Multiplayer replicates stable appearance IDs and colors; it never sends generated
images.

## Runtime flow

1. The server validates wardrobe ownership and replicates `PlayerAppearanceState`.
2. The client builds a versioned appearance key.
3. `CharacterSpriteCompiler` composites the canonical source atlases through explicit material
   masks.
4. The compiler emits a 216x216 walk atlas and a 288x216 action atlas.
5. Three.js stores both textures in a bounded 96-entry appearance cache.
6. Semantic action policy selects frames without knowing how the texture was authored.

`shared/content/character-animation-manifest.ts` is the frame contract. Code should reference
semantic clips such as `walk`, `melee`, `dead`, and `vehicleEnter`, rather than introducing new
numeric frame assumptions.

## Material masks

Masks live under `public/assets/custom/characters/<body-family>/masks/`. Current channel colors:

| Mask color | Material |
| --- | --- |
| `#ff0000` | skin |
| `#804000` | hair |
| `#00ff00` | primary/top |
| `#0060ff` | secondary/bottom |
| `#ff00ff` | shoes |

Mask shading comes from the source atlas, while hue comes from the appearance recipe. Structural
details such as silhouettes, sleeves, hats, and accessories will move into authored transparent
part layers. Existing catalog entries are explicitly marked `procedural-fallback` until those
layers exist. The runtime never paints geometric stand-ins for those parts: unavailable silhouettes
fall back to the coherent authored base character and only supported material channels are recolored.

The standard body uses `base/walk.png` for idle and movement and `player-actions.png` for semantic
actions. Both sheets must depict the same character proportions and viewing angle. Do not point a
body atlas back at a legacy game sprite and attempt to disguise it with post-render rectangles.

## Adding an authored part

1. Use the canonical 72x72 frame templates and animation manifest.
2. Produce aligned transparent walk and action layers for one body family.
3. Preserve the root, head, and hand anchors in every frame.
4. Add material masks for every tintable channel.
5. Declare slot, body compatibility, clips, occlusion, and `renderMode: authored-layers`.
6. Run the character sprite contract tests and generate a visual montage.
7. Approve the asset before adding it to wardrobe grants or stores.

AI is an authoring accelerator only. Generated sheets must pass background removal, frame split,
scale normalization, anchor alignment, material-mask extraction, artifact checks, and visual
approval before entering the catalog.

## Creator preview

The character creator invokes the same compiler as gameplay. Its IDLE, WALK, HIT, CAR, and DOWN
tabs inspect the actual compiled frames, so an item cannot appear correct in the menu while using
a different runtime representation.

## Verification

```bash
npx tsx --test test/appearance-render-policy.test.ts test/character-sprite-system.test.ts
npx tsc --noEmit
npx vite build
```

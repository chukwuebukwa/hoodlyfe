# Vehicle Sprite Generation Guide

## Vehicle Workshop

The complete local production workflow is available at:

```text
http://localhost:5173/vehicles
```

The workshop visualizes the same canonical pipeline used by the command line:

### Test drive

After accepting a closed frame, use **Test drive** in the toolbar to open a private parking lot. The lot is assembled from the same district asphalt and sidewalk tile atlas as the game. It renders the accepted sprite with its saved presentation offset and runs the same shared vehicle-motion integrator as the game. The current workshop handling values are passed directly into that integrator, so the lot checks artwork fit, grip, power oversteer, handbrake drift, and driving balance before compilation. Rear tyres leave fading skid marks when lateral slip is high, and the same slip-driven skid audio used in the main game fades in during the slide.

- `WASD` or arrow keys: drive
- `Space`: handbrake
- `R`: reset
- `Esc`: close

The lot is client-only. It does not join multiplayer, persist position, or modify the source manifest.

```text
Brief -> generated candidate -> processed 96px source -> door variants
      -> collision fit -> handling and population -> compile -> game output
```

The UI and CLI do not have separate build logic. The UI writes `vehicle.json` and accepted
source frames, then invokes `npm run vehicles:build`.

Image generation is enabled when `OPENAI_API_KEY` is available to the Next.js server. The
key is never sent to the browser. Without it, the workshop remains fully usable through
PNG upload, editing, validation, compilation, and runtime preview.

Generated images use `gpt-image-2` by default. Override the model with
`VEHICLE_IMAGE_MODEL`. Raw generation deliberately uses a solid magenta background because
GPT Image 2 does not currently provide transparent output. The repository-owned
`scripts/process-vehicle-sprite.py` performs chroma cleanup, largest-component isolation,
proportional fitting, centering, edge checks, and the final 96x96 RGBA export.

NOCK0 vehicles are top-down 96x96 sprites. The Three.js renderer rotates one sprite in-world, so new civilian cars do not need directional animation sheets.

## Runtime Contract

- Active atlas: `public/assets/custom/actions/vehicle-doors.png`
- Cell size: `96x96`
- Atlas columns: `5`
- One row per `VehicleKind`; the current atlas is `480x576` for six vehicle rows.
- Row order is assigned by `presentation.atlasRow` in each source manifest and emitted into
  `shared/content/vehicle-catalog.generated.json`.
- `public/assets/original/sprites/vehicles.png` is older/base vehicle art; live vehicle meshes use the door atlas.

The runtime atlas and generated runtime catalog are outputs. The source of truth is one
folder per vehicle:

```text
public/assets/custom/vehicles/
  sedan/
    vehicle.json
    closed.png
    front-left.png
    front-right.png
    rear-left.png
    rear-right.png
    meta.json
  suv/
    vehicle.json
    closed.png
    front-left.png
    front-right.png
    rear-left.png
    rear-right.png
    meta.json
```

`vehicle.json` owns:

- identity and draft/ready state
- physics and collision footprint
- handling and traffic behavior
- parked and ambient population eligibility
- stable atlas row
- per-door sprite offsets
- generation prompt and model provenance

Do not add vehicle definitions directly to `shared/content/vehicle-catalog.ts`. That file
reads `shared/content/vehicle-catalog.generated.json`, which is rebuilt from the manifests.
The workshop compacts atlas rows whenever a vehicle moves between draft and ready states,
so drafts can be created and published in any order.

Door columns:

1. Closed
2. Front-left open
3. Front-right open
4. Rear-left open
5. Rear-right open

For quick generated civilian cars, duplicate the closed sprite into all five columns. The car is playable immediately; door-open art can be replaced later.

## Skill Plan

Use `$generate2dsprite` as a single top-down asset workflow:

- `asset_type`: `prop`
- `action`: `single`
- `view`: `topdown`
- `sheet`: single asset
- `bundle`: `single_asset`
- `anchor`: `center`
- `art_style`: `project-native` or `pixel_art`

Generate one car at a time. Do not generate a large mixed car pack for production candidates, because collision-bearing vehicle silhouettes need stable scale and clean per-car QC.

## Prompt Template

```text
Create one top-down 2D pixel-art civilian car sprite for NOCK0.
The car is viewed directly from above with a slight readable top surface, like a GTA-style top-down vehicle.
Transparent-ready sprite on a 100% solid flat #FF00FF magenta background.
No text, no labels, no UI, no shadow baked into the background, no ground tile.
The entire car must fit inside one square frame with generous magenta padding on all sides.
The car should be centered, vertical nose-up, with crisp dark outline, readable windshield, roof, hood, trunk, headlights, taillights, and wheels.
Style should match small top-down pixel-art cars in an urban crime game, not fantasy, not toy-like, not isometric.
Target shape: [vehicle description].
Primary color: [color].
```

Good first civilian set:

- black compact SUV
- beige delivery van
- red muscle coupe
- gray beater compact
- dark green station wagon
- white luxury sedan
- blue hatchback
- brown pickup truck

## Processing

After image generation, process the raw image into a 96x96 transparent sprite:

```bash
python3 /Users/jimmyjiggler/.codex/skills/generate2dsprite/scripts/generate2dsprite.py process \
  --input path/to/generated-raw.png \
  --target asset \
  --mode single \
  --output-dir art/generated/vehicles/black-suv \
  --rows 1 \
  --cols 1 \
  --cell-size 96 \
  --single-size 96 \
  --fit-scale 0.90 \
  --align center \
  --component-mode largest \
  --strict-qc
```

Use `sheet-transparent.png` as the closed car frame.

## Install Into Source Folder

Copy the accepted closed frame into the vehicle source folder:

```bash
mkdir -p public/assets/custom/vehicles/black-suv
cp art/generated/vehicles/black-suv/sheet-transparent.png \
  public/assets/custom/vehicles/black-suv/closed.png
```

For quick prototypes, copy `closed.png` into the four door-open names. For production cars, generate
or draw each open-door source frame.

## Build The Runtime Atlas

After editing vehicle source folders, rebuild every generated runtime artifact:

```bash
npm run vehicles:build
```

The compiler validates manifests and source frames, writes
`shared/content/vehicle-catalog.generated.json`, and builds
`public/assets/custom/actions/vehicle-doors.png`.

CI and production builds use:

```bash
npm run vehicles:check
```

This rebuilds into temporary files and fails if committed generated output is stale.

For quick row experiments only, `scripts/install-vehicle-door-row.py` can still replace a single
runtime atlas row. Do not treat that as the durable source of truth.

## Add The Vehicle Kind

Create:

- `public/assets/custom/vehicles/<vehicle-id>/vehicle.json`
- five accepted source frames

The compiler derives `VehicleKind`, atlas rows, population lists, and sprite offsets.

Run:

```bash
npm run build
npx tsx --test test/vehicle-workshop-pipeline.test.ts test/action-sprite-assets.test.ts test/action-sprite-policy.test.ts test/vehicle-actions.test.ts test/traffic-controller.test.ts
```

## QC Checklist

- Car fits inside 96x96 without clipping.
- Nose points up in the source sprite.
- Transparent background is clean.
- Visual length roughly matches the catalog collision length.
- Sprite center matches collision center.
- Does not look isometric or side-view.
- No baked road, shadow, smoke, fire, lights, text, logo, or scenery.

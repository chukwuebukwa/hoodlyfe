# Asset Policy

## Repository Contents

The source repository contains original NOCK0 code and the OpenGTA2 converter source used for local asset export. GTA2 game data and GTA2-derived maps, textures, sprites, and vehicles are generated locally and excluded by `.gitignore`.

Ignored outputs include:

- `public/assets/maps/district-map.json`
- `public/assets/maps/district-tiles.png`
- `public/assets/maps/district-preview.png`
- `public/assets/maps/district-overlay.png`
- `public/assets/maps/district-map.metadata.json`
- `public/assets/custom/sprites/*.png`
- `GTA2_GAME/`
- `GTA2_EXTRACTED/`

## Original Runtime Sprites

The active player, civilian, and police sheets are original AI-assisted pixel art stored under `public/assets/original/sprites/`. Each file is a transparent 216-by-216 PNG containing nine 72-by-72 frames in a 3-by-3 grid. The generated master source is retained under `art/source/characters-master-chroma.png`.

The live Three.js vehicle renderer draws from `public/assets/custom/actions/vehicle-doors.png`.
It is a 96-by-96 door atlas with five columns per vehicle kind: closed, front-left open,
front-right open, rear-left open, and rear-right open. Row order follows
`VehiclePresentationDefinition.frame` in `shared/content/vehicle-catalog.ts`.
`public/assets/original/sprites/vehicles.png` is retained as older/base vehicle art and is still
loaded by the renderer lifecycle, but the current vehicle mesh path uses the door atlas so entry
and carjacking can swap frames deterministically. Police lights, vehicle damage tinting, smoke, and
fire remain runtime effects rather than separate derived assets.

These files replace the GTA2-derived pedestrian and vehicle sheets at runtime. The city map remains generated from the local GTA2 installation for compatibility testing.

## Vehicle Skid Audio

The tyre scrub and drift recordings under `public/assets/audio/sfx/skids/` are user-supplied
NOCK0 source assets. The browser schedules them as overlapping Web Audio one-shots rather than
hard-looping a WAV file. Both the main game and Vehicle Workshop drive playback from the same
speed/slip-angle policy; nearby game vehicles use positional attenuation and stereo panning.

## Reactive Street Props

The custom dumpster, hydrant, and trash-can assets under `public/assets/custom/props/` use
three-frame horizontal damage sheets: intact, damaged, and destroyed. Their generated source,
effect masters, and processing metadata live under `art/source/`.

The server deterministically distributes props from the collision and road layers. Hydrants
prefer curb cells, trash cans prefer sidewalk or building edges, and dumpsters prefer deeper
service edges. Generated placements are rejected on road tiles and blocked footprints, then bound
to the highest traversable authored surface at that coordinate so ground, ramps, and bridge decks
remain physically distinct. The industrial map derives its entire prop population from these
placement rules; there are no hardcoded showcase props at player spawn.

Props use the normal street area-of-interest replication radius, so clients only receive nearby
state. The Three.js presenter groups visible props into `InstancedMesh` batches by definition and
damage stage, limiting the static prop path to nine draw calls while retaining per-instance hit
kick, wobble, and flash. Water and trash debris remain pooled client-side presentation effects;
the server never replicates individual particles.

Vehicle contact is authoritative. Props block parking-speed bumps, while impacts at or above 95
world units per second destroy them. Vehicle paths are swept between simulation ticks and tested
against a small prop spatial index, so fast cars cannot tunnel through props and the district-wide
prop population does not require a full vehicle-by-prop scan.

## Local Development

`npm run assets:export` reads `bil.gmp` and `bil.sty` from a local GTA2 installation. Keep the original game files untracked. By default the script looks for `GTA2_GAME/App_Executables/` inside the repository working tree, but that directory is ignored by git and must not be committed.

Useful export options:

```bash
GTA2_LEVEL=wil npm run assets:export
OPENGTA2_PATH=/path/to/GTA2/App_Executables npm run assets:export
```

To export the complete Downtown district into its isolated runtime asset root, run:

```bash
npm run map:generate-downtown
npm run map:generate-residential
npm run map:compile-world
```

Then start the web and game servers. Open `http://localhost:5173/city` for Downtown or
`http://localhost:5173/residential` for Residential. Both use exported map geometry, surfaces,
collision, and road classifications. Industrial-specific lanes, ambient population, traffic
signals, services, and interiors remain disabled until district-specific gameplay metadata is
authored.

`http://localhost:5173/world` loads the experimental composite atlas. The compiler places
Downtown northwest, Industrial northeast, and Residential southwest, namespaces their authored
surfaces, stacks their texture atlases, and creates four four-block-wide connection roads with
dedicated shoulder and center-line tiles. It also emits `phone-world-map.webp`; the phone Maps
app projects the local player's current district coordinates into this shared atlas. Generated
world output remains ignored alongside the source GTA-derived exports.

Raw export is intended for converter development. To resize the active district, use the
transactional map pipeline so gameplay coordinates move with the source crop:

```bash
npm run map:expand -- 256
npm run map:validate
```

See `docs/MAP_EXPANSION_GUIDE.md` before changing crop size. A direct
`GTA2_CROP_SIZE=... npm run assets:export` does not rebase authored lanes, interiors,
signals, lights, or population zones.

The generated files are suitable for private development and compatibility testing only unless the operator has separate rights to distribute them.

## Public Builds

Do not publish, commit, package, or serve GTA2-derived assets to third parties without confirming the necessary rights. A public NOCK0 release still needs original or appropriately licensed map imagery, names, logos, and audio.

OpenGTA2 source code is governed by its own license. NOCK0's use of OpenGTA2 as a converter does not change the ownership or licensing of the input game data.

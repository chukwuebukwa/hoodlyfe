# Asset Policy

## Repository Contents

The source repository contains original NOCK0 code and converter changes only. GTA2-derived maps, textures, sprites, and vehicles are generated locally and excluded by `.gitignore`.

Ignored outputs include:

- `public/assets/maps/district-map.json`
- `public/assets/maps/district-tiles.png`
- `public/assets/maps/district-preview.png`
- `public/assets/maps/district-overlay.png`
- `public/assets/maps/district-map.metadata.json`
- `public/assets/custom/sprites/*.png`

## Original Runtime Sprites

The active player, civilian, and police sheets are original AI-assisted pixel art stored under `public/assets/original/sprites/`. Each file is a transparent 216-by-216 PNG containing nine 72-by-72 frames in a 3-by-3 grid. The generated master source is retained under `art/source/characters-master-chroma.png`.

The active vehicle sheet is original AI-assisted pixel art stored at `public/assets/original/sprites/vehicles.png`. It contains civilian, police, and taxi frames in the existing 96-by-96 runtime contract. The generated master source is retained at `art/source/vehicles-master-chroma.png`. Police lights, vehicle damage tinting, smoke, and fire remain runtime effects rather than separate derived assets.

These files replace the GTA2-derived pedestrian and vehicle sheets at runtime. The city map remains generated from the local GTA2 installation for compatibility testing.

## Local Development

`npm run assets:export` reads `bil.gmp` and `bil.sty` from a local GTA2 installation. Keep the original game files outside this repository. The generated files are suitable for private development and compatibility testing only unless the operator has separate rights to distribute them.

## Public Builds

Do not publish, commit, package, or serve GTA2-derived assets to third parties without confirming the necessary rights. A public NOCK0 release still needs original or appropriately licensed map imagery, names, logos, and audio.

OpenGTA2 source code is governed by its own license. NOCK0's use of OpenGTA2 as a converter does not change the ownership or licensing of the input game data.

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

## Local Development

`npm run assets:export` reads `bil.gmp` and `bil.sty` from a local GTA2 installation. Keep the original game files outside this repository. The generated files are suitable for private development and compatibility testing only unless the operator has separate rights to distribute them.

## Public Builds

Do not publish, commit, package, or serve GTA2-derived assets to third parties without confirming the necessary rights. A public NOCK0 release should replace the map, pedestrian sheets, vehicle sheets, names, logos, and audio with original or appropriately licensed material.

OpenGTA2 source code is governed by its own license. NOCK0's use of OpenGTA2 as a converter does not change the ownership or licensing of the input game data.

# Original Map Pipeline

This is an inactive visual experiment. NOCK0 currently uses the locally generated GTA2 compatibility map. The offline renderer can preserve the 64-by-64 gameplay contract while producing experimental 4096-by-4096 base and overlay images, but its output is not loaded by the game.

## Reference Inventory

The compatibility map was reviewed for visual categories rather than copied as artwork. Its useful categories include:

- asphalt roads, parking surfaces, concrete pavers, grass, dirt, brick, gravel, tar, and corrugated metal;
- curbs, gutters, parapets, roof edges, inner and outer corners, lane paint, crosswalks, and parking bays;
- HVAC fans, vents, skylights, tanks, solar panels, antennas, pipes, planters, dumpsters, utility boxes, manholes, and stairs;
- fences, streetlights, utility poles, cables, gantries, catwalks, bridge supports, hazard markings, trusses, and crane structures.

## Build

```bash
npm run assets:export
npm run assets:original-map
```

The first command currently supplies the compatibility road and collision grids. The second command reads only those semantic grids and writes the active runtime assets to `public/assets/original/maps/`.

If `art/source/map-materials.png` exists, the renderer reads it as a four-column, two-row source board in this order:

1. asphalt;
2. sidewalk;
3. grass;
4. brick roof;
5. gravel roof;
6. corrugated metal roof;
7. tar roof;
8. industrial concrete roof.

Processed transparent props under `public/assets/original/map-props/` override the renderer's procedural fallbacks. The renderer remains deterministic when those sources are absent.

## Outputs

- `district-map.json`: original runtime tileset metadata with the authoritative collision and road arrays;
- `district-map.metadata.json`: spawn data and a manifest of materials and props;
- `district-tiles.png`: transparent one-tile atlas required by the hidden Phaser collision layer;
- `district-preview.png`: complete original ground and rooftop rendering;
- `district-overlay.png`: elevated cables, fences, gantries, trusses, and crane structures.

Changing the visual renderer does not change authoritative movement, traffic routing, line of sight, spawn selection, or collision tests.

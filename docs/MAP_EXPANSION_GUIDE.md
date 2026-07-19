# Full-World Map Streaming Guide

## Active World

The active Industrial District is the complete `256 x 256` GTA2 source level. Each tile is
`64` world pixels, producing a `16384 x 16384` world at source origin `0,0`.

The world is not one Three.js mesh. Export divides it into `8 x 8`-tile (`512 x 512` pixel)
chunks:

```text
32 columns x 32 rows = 1,024 chunks
```

`public/assets/maps/three/world.json` is the geometry manifest. Chunk payloads live under
`public/assets/maps/three/chunks/`. The old `three/prototype.json` monolith is deliberately
absent for full-world exports.

## Runtime Contract

The Three renderer keeps these small or simulation-critical datasets resident:

- the world manifest, chunk descriptors, surface grid, and authored roof definitions;
- the shared texture atlas;
- the collision and road-classification grid used by prediction and world queries;
- authored gameplay catalogs such as interiors, services, signals, lights, and lanes.

It streams expensive presentation geometry by camera interest:

1. Chunks intersecting the viewport are visible priority and are loaded before the first frame.
2. One surrounding ring is preloaded.
3. Two surrounding rings are retained to prevent boundary thrash.
4. Velocity lookahead requests up to two chunks in the travel direction.
5. No more than four chunk requests run concurrently.
6. Chunks outside the retention region are removed and their GPU geometry is disposed.

This is static-world streaming. Server population and replication have separate AOI systems:
pedestrians and traffic outside player interest remain lightweight virtual records, while only
bounded nearby actors become authoritative replicated entities. Static collision remains
resident because a `256 x 256` byte-scale occupancy grid is cheap and client prediction needs
immediate deterministic queries.

## Export Or Resize

Keep a local GTA2 installation under `GTA2_GAME/App_Executables/`, then run:

```bash
npm run map:expand -- 256
npm run map:validate
npm test
npm run build
```

The size must be a multiple of eight from `16` through `256`. `map:expand` performs one
transaction:

1. Export into a temporary staging directory.
2. Calculate the coordinate delta from old and new source origins.
3. Rebase lanes, junctions, roadblocks, vehicle poses, stingers, and officers.
4. Export a shared atlas, world manifest, and independent geometry chunks.
5. Install maps, previews, textures, metadata, manifest, and chunk directory.
6. Regenerate `shared/content/district-map-frame.generated.ts`.
7. Validate dimensions, chunk coverage and totals, spawn, surfaces, lane graph, roofs,
   interiors, signals, lights, and population zones.
8. Restore the prior map automatically if export, installation, or validation fails.

The exporter writes a legacy monolith only for crops up to `128` tiles. Full-world builds
must use the chunk manifest.

## Coordinate Contract

The former `64 x 64` crop remains the stable authoring reference:

```text
reference source origin: 96,97
active source origin:     0,0
tile size:                64 pixels
active authoring offset:  +6144,+6208 pixels
```

TypeScript content authored in the reference frame must use:

```ts
districtPoint(x, y)
districtBounds({minX, minY, maxX, maxY})
```

Do not write the current offset manually. `district-lanes.json` is generated content and is
rebased transactionally. The frame helpers currently own interiors, doors, exits, services,
obstacles, signals, street lights, and population-zone bounds.

## What The Full Export Provides

All 65,536 source tiles now have exported visuals, collision, roads, pedestrian surfaces,
height data, and streamable Three geometry. Players can travel and collide throughout the
complete source level.

The authored lane graph and handcrafted systemic content still describe the translated
central reference district. Geometry streaming does not invent safe lane direction,
intersection priority, signals, parking, services, interiors, missions, or named population
zones for the rest of the source world. Generic road-cell traffic can support fallback areas,
but production-quality traffic needs connected authored corridors and junction metadata.

Treat world expansion and world content as separate workstreams:

- **World availability:** complete; geometry and collision can stream across all 256 tiles.
- **Authored systemic coverage:** expand lanes, services, interiors, lighting, and activities
  district by district without changing the streaming architecture.

## Debug And QA

Run the game and open:

```text
http://127.0.0.1:5173/?renderer=three&qa=1
```

Enable `DBG`. The map row reports:

```text
loaded / 1024 | loading | queued | retained | failures | loaded triangles
```

At ordinary zoom, `loaded` must remain a small local subset rather than approaching `1024`.
Driving across an 8-tile boundary should load chunks ahead and retire distant chunks without
a black frame or geometry pop inside the viewport.

Required checks:

- `world.json` loads once and nearby chunk requests return `200`;
- `prototype.json` returns `404` for the full world;
- the canvas is nonblank and centered at the rebased spawn;
- the player and collision agree with buildings and elevated structures;
- authored interiors hide only their roof fragments, including roofs spanning chunk edges;
- minimap, camera, lighting, population AOI, and replication remain centered on players;
- chunk failures remain zero while crossing boundaries;
- desktop and mobile canvases stay full viewport without text or HUD overlap.

## Transport Follow-Ups

The first full-world implementation uses compact JSON chunks for inspectability. Before a
large public release, move vertices and indices to versioned binary payloads, serve immutable
hashed chunks through a CDN with Brotli, and add worker-side decode if profiling shows main
thread spikes. Those are transport optimizations; they do not change manifest interest,
retention, unloading, or gameplay coordinate ownership.

# District Map Expansion Guide

## Current District

The active Industrial District crop is `96 x 96` GTA2 tiles. Each tile is `64` world
pixels, producing a `6144 x 6144` world. The source crop begins at GTA2 map tile
`80,81`; the former `64 x 64` crop began at `96,97`.

Use `96` as the normal development size for now. The exporter accepts up to `128`, but the
current Three.js payload is still one large JSON document. At `96`, `prototype.json` is
already about 13 MB, so a production `128` map should follow chunked presentation streaming
rather than becoming a larger monolithic payload.

## Expand Safely

Keep a local GTA2 installation under `GTA2_GAME/App_Executables/`, then run:

```bash
npm run map:expand -- 96
npm run map:validate
npm test
npm run build
```

`map:expand` performs these steps as one transaction:

1. Export the requested crop into a temporary staging directory.
2. Read the old and new source origins and calculate the world-coordinate delta.
3. Rebase `district-lanes.json`, including corridors, junctions, roadblocks, vehicle poses,
   stingers, and officer poses.
4. Install the staged map, previews, tiles, metadata, and Three.js prototype.
5. Regenerate `district-map-frame.generated.ts`.
6. Validate the frame, dimensions, spawn, surfaces, lane graph, occluders, interiors,
   traffic signals, street lights, and population zones.
7. Restore the previous files automatically if installation or validation fails.

Expansion only resizes the current source level. It refuses to transplant authored gameplay
content onto a different GTA2 level because matching the new roads, buildings, and services
requires a separate content-authoring project.

Running the same size again is supported. It produces a zero coordinate delta and should
not create `bin/` or `obj/` churn under the OpenGTA converter.

## Coordinate Contract

The original `64 x 64` crop is the stable authoring reference frame:

```text
source origin: 96,97
tile size:     64 pixels
```

Content authored against that frame must use the helpers in
`shared/content/district-map-frame.ts`:

```ts
districtPoint(x, y)
districtBounds({minX, minY, maxX, maxY})
```

The active generated frame translates those reference coordinates at runtime. Do not add a
manual `+1024` offset for the `96 x 96` map. That would break the next expansion or crop
change.

`district-lanes.json` is generated content and is rebased by `map:expand`. TypeScript-owned
content currently using the frame helpers includes:

- interiors, exterior doors, exits, service anchors, and obstacles;
- traffic signal centers and approach stop lines;
- street-light fixtures;
- population-zone bounds.

When adding another map-relative content owner, include it in the generated frame contract
and in `scripts/validate-district-map.ts` before relying on it.

## What Expansion Provides

The additional ring has exported visuals, collision, road classification, pedestrian
surfaces, and Three.js geometry. Player movement, collision, generic pedestrian placement,
and world queries can use it immediately.

The authored lane graph still describes the former central `64 x 64` source area, translated
into the larger crop. Ambient traffic therefore remains concentrated in that authored road
network. Expanding the crop does not invent safe lane direction, intersection priority,
traffic-light approaches, parking, roadblocks, services, or interiors for the new perimeter.

The next map-content pass should author additional connected corridors and junctions in
`district-lanes.json`, validate strong connectivity, and add traffic signals only where the
new graph requires them. Do not fall back to treating every road-classified tile as an
equally valid traffic route.

## Visual QA

Start the game and open the Three.js renderer:

```bash
npm run dev
```

Then verify `http://127.0.0.1:5173/?renderer=three&qa=1` at desktop and mobile sizes:

- the canvas is nonblank and fills the viewport;
- the player spawns near the center source geography;
- collision agrees with buildings and elevated structures;
- interiors hide only their authored roof groups;
- the minimap and camera remain centered near the expanded boundaries;
- existing traffic stays on the authored central graph;
- no map, texture, or prototype requests fail in the browser console.

The current narrow-screen shell has pre-existing horizontal canvas and HUD overflow. The
expanded map renders on a mobile viewport, but responsive shell cleanup remains separate
from map generation.

## Reverting Size

The same command can return to another supported crop:

```bash
npm run map:expand -- 64
```

The lane graph is translated back using source-origin metadata. Run the complete validation
and QA sequence after any size change. Git remains the final recovery path for reviewed map
assets; the command's temporary backup exists only for the duration of one expansion run.

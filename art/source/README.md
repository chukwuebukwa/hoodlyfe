# Character Sprite Source

`characters-master-chroma.png` is the AI-generated source used for NOCK0's original player, civilian, and police animation sheets.

Generation brief:

- Original strict-overhead pixel-art characters matched to the world's near-vertical camera.
- Three role blocks: urban player, civilian in green, and navy police officer.
- Nine production frames per role: one idle frame and an eight-frame walk cycle. The police source contains six unique poses, which are sequenced into the same nine-frame runtime contract.
- Neutral hands with no weapons so held weapons can be separate runtime overlays.
- Flat magenta chroma background for deterministic transparency extraction.

The production sheets are under `public/assets/original/sprites/`. They were chroma-keyed, trimmed, nearest-neighbor scaled, and centered into the existing 72-by-72 frame contract.

## Vehicle Sprite Source

`vehicles-master-chroma.png` is the AI-generated source for the original civilian sedan, police cruiser, and taxi sheet. The production sheet is stored at `public/assets/original/sprites/vehicles.png` with three transparent 96-by-96 frames. Runtime rendering adds the alternating police lights, damage tint, smoke, and fire.

## Minimap Location Source

`location-icons-atlas.png` is the source-art sheet for permanent Ammu-Nation, Threads, hospital, and repair-garage map symbols. The centered transparent 64-by-64 production crops live under `public/assets/custom/minimap/`; the browser does not load or ship the source atlas.

## Street Prop Source

`street-props-master-chroma.png` is the generated 3-by-3 source sheet for the first custom runtime street-prop pack. It contains three dumpsters, three hydrants, and three trash cans on a solid magenta background. The production sprites are centered on transparent 96-by-96 canvases under `public/assets/custom/props/` and intentionally use family-specific world scale rather than normalizing every object to the same size.

`street-props-damage-master-chroma.png` is the generated 3-by-3 damage-state source.
The runtime uses three-frame horizontal sheets for the dark-green dumpster,
red-and-brass hydrant, and galvanized trash can. Frame order is intact, damaged,
destroyed.

The `street-prop-effects/` directory contains generated chroma masters and QC
metadata for reactive prop effects. `hydrant-water-master-chroma.png` is a
six-frame 2-by-3 water loop with a shared nozzle origin. The runtime sheet is
`public/assets/custom/props/effects/hydrant-water.png`. The 3-by-3
`trash-debris-master-chroma.png` atlas supplies nine paper, can, bottle, bag,
and cardboard pieces used by deterministic client-side debris bursts. Runtime
physics, frame selection, settling, and fading are presentation-only; the
server continues to replicate prop damage state rather than individual pieces.

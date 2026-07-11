# Vehicle Night Lighting Research

Updated: 2026-07-11

## Purpose

Define a bounded client-presentation slice for readable traffic at night. Vehicle lights do not affect authoritative driving, visibility, collision, AI, or replication.

## Production Reference

Pinned clean-room reference: `daynz/GTAviceCity` at the locally pinned source revision.

Relevant implementation: `src/vehicles/Automobile.cpp`, approximately lines 1640-1880.

The production implementation separates these concerns:

- world time and weather decide whether normal vehicle lamps should be active;
- engine/abandoned/wreck state gates lamp operation;
- front and rear lamp locations are model metadata rather than inferred every frame;
- front and rear light damage independently suppresses illumination;
- braking increases red rear intensity while reversing uses white rear lamps;
- corona visibility depends on camera orientation and distance;
- expensive directional and point-light casts are restricted to the player vehicle while other cars retain cheaper visible lamps;
- headlight and taillight shadows are separate ground projections.

## NOCK0 Translation

The current browser slice deliberately implements only rules supported by replicated state:

- shared world darkness drives intensity;
- destroyed, burning, unoccupied non-traffic vehicles do not emit normal lamps;
- front/rear component damage fades the corresponding presentation;
- negative replicated speed selects white reverse lamps;
- only the ten nearest replicated vehicles receive glow meshes;
- the effect is renderer-owned and creates no server traffic or gameplay state.

Brake lamps are not inferred from speed deltas because that would produce client-dependent flicker. A future authoritative or presentation-safe braking fact can add them. Model-specific lamp anchors should move into vehicle presentation metadata when original vehicle art replaces the current shared 96x96 atlas.

## Exit Criteria

- Daylight, distant, destroyed, burning, and abandoned cars do not emit lamps.
- Operable nearby traffic and occupied cars emit damage-scaled front/rear glows at night.
- Reverse lamps are visibly distinct from red rear lamps.
- At most ten replicated vehicles own active glow presentation per client.
- Production build, focused policy tests, full suite, and live traffic visual QA pass before promotion from foundation status.

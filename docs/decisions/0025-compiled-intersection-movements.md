# 0025 - Compile Intersection Movements From Directed Corridors

## Status

Accepted

## Context

The level editor previously required authors to reason about compiled lane nodes and connector
edges. One-way carriageways made this especially brittle: a visually plausible crossing could
still create sinks, illegal opposing movements, or a different graph in Preview and production.
Hand-authoring every lane-to-lane turn would also scale poorly as lane counts and road layouts
grow.

## Decision

Authors own only the physical traffic contract:

- corridor centerlines and point order;
- forward, reverse, or bidirectional travel;
- lanes per direction and speed limits;
- exact corridor crossings represented by junctions;
- optional allowed-turn restrictions and explicit terminal transfers.

A shared, deterministic compiler derives the operational intersection network. For every
junction it produces incoming and outgoing lane approaches, legal straight/left/right movements,
lane-to-lane connector edges, sampled cubic turn curves, compatible signal groups, and directed
network diagnostics.

Lane-role rules are deterministic. The innermost lane may turn left, the outermost lane may turn
right, and every lane may continue straight into the corresponding outbound lane. Disabled
corridor directions do not produce approaches, movements, or connector edges. U-turns exist only
at explicitly enabled terminal transfers.

Generated IDs are stable functions of junction, lane, direction, and movement IDs. Generated
artifacts are never stored in the authored level document. The editor, Preview compiler,
authoritative `LaneGraph`, route system, validation, and debug visualization all consume the same
shared compiler output.

Signal groups describe non-conflicting compatible movements. Runtime intersection reservations
remain authoritative and continue to serialize vehicles that share an entry lane or conflict
geometrically. Signal groups are therefore compiled control data, not client-side decoration.

## Consequences

- Designers no longer place connector edges or hand-draw turn curves.
- One-way divided roads connect through the same junction workflow as ordinary streets.
- Selecting a junction exposes generated approach, movement, turn, and phase counts and renders
  the generated paths directly on the map.
- Structurally invalid junctions report their root authoring error without duplicate derived
  compiler errors.
- Changing lane-role policy, curve shape, or signal grouping requires a compiler version change
  and regression tests because it changes authoritative traffic behavior.
- Future explicit turn-lane markings can override the deterministic defaults without changing the
  saved representation of generated connector geometry.

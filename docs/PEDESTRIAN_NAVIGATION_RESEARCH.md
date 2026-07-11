# Pedestrian Navigation Research and Interim Contract

Date: 2026-07-10

Primary behavioral reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference separates pedestrian route ownership from tactical behavior and vehicle routing.

- `CPathFind` keeps pedestrian and vehicle path nodes distinct because sidewalks, road lanes, crossings, and legal connections are different graphs.
- Pedestrians retain route progress, previous/next nodes, destinations, and blocked recovery instead of asking for a complete path every frame.
- Path searches are bounded by fixed node buffers. A missing route is a normal outcome that must degrade to local recovery rather than stall the simulation.
- Nearest-node selection, disabled links, crossing metadata, and route-node ownership are explicit concerns rather than incidental collision checks.
- Behavior decides why and where an actor needs to move. Navigation chooses a reachable route, and locomotion applies collision-safe movement.

References:

- [`PathFind.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/PathFind.h)
- [`PathFind.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/PathFind.cpp)
- [`PedRoutes.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedRoutes.h)
- [`PedAI.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedAI.cpp)

The source was used to identify system boundaries and failure modes. NOCK0 uses an original TypeScript implementation, original constants, and deterministic tests.

## Interim NOCK0 Adapter

The current development map has collision tiles but no authored sidewalk graph. `PedestrianPathPlanner` therefore provides a bounded compatibility layer over that collision grid:

- deterministic eight-direction A* with stable tie breaking;
- diagonal corner checks and full pedestrian-footprint clearance;
- a direct-path visibility shortcut before any search;
- nearest-open start/goal resolution for imperfect event destinations;
- route smoothing after search;
- a maximum of 384 expanded nodes and 28 retained waypoints;
- a maximum of two new path requests per simulation tick;
- private route reuse, waypoint progress, goal-change invalidation, and timed retry;
- local deterministic blocked recovery when no route is available.

Civilian reaction state now owns a stable flee destination and event investigation goal. Police behavior supplies pursuit, search, or investigation destinations while retaining an independent authoritative aim angle. Navigation may alter locomotion direction but cannot alter fire targeting or behavior state.

This adapter is intentionally not the final pedestrian navigation model. It does not infer that every open road tile is a legal sidewalk, understand crossings or traffic signals, reserve narrow passages, or coordinate crowds.

## Debug Contract

F3 diagnostics expose private route state only to subscribed developer clients:

- navigation goal;
- current waypoint index and bounded waypoint list;
- route polyline and waypoint markers;
- `path:current/total` label state.

Ordinary clients receive only authoritative NPC position, facing, and presentation action. They do not receive or advance AI routes.

## Production Replacement Path

The original map pipeline should eventually emit a versioned pedestrian graph containing:

- sidewalk centerlines and legal direction links;
- crossings, stop lines, signal ownership, stairs, doors, and district-transfer edges;
- semantic destinations such as shops, homes, transit stops, cover, and safe gathering points;
- route costs for danger, congestion, traffic exposure, and actor archetype;
- graph-versioned path-cache keys and a deterministic request queue;
- level-of-detail rules for full, reduced, and virtual ambient actors.

`PedestrianNavigationSystem` remains the behavior-facing owner when that graph arrives. Replacing the planner must not change reaction, police, locomotion, protocol, or room ownership.

## Acceptance Coverage

- A blocked destination produces the same route for the same world and inputs.
- Routes do not cut diagonally through blocked corners and preserve actor clearance.
- Search expansion and per-tick request budgets are explicit and tested.
- Direct paths do not spend the route budget.
- Police movement detours cannot alter authoritative aim or fire cadence.
- Respawn and destination changes clear private route ownership.
- Debug snapshots copy waypoint arrays so later runtime mutation cannot change published history.
- Existing multiplayer combat, wanted, traffic, missions, death, and respawn behavior remains green.

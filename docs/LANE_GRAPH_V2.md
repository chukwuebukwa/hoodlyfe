# Lane Graph V2

Lane Graph V2 turns the road-cell layer into a complete, editable, directed traffic network. The road mask remains the source of truth for drivable geometry; the compiled graph is the source of truth for traffic movement.

## Generation pipeline

1. Keep the largest connected road-cell component.
2. Thin that surface into a one-cell centerline skeleton.
3. Collapse crossings into junction regions and trace the paths between them.
4. Classify every corridor as `arterial`, `boulevard`, `street`, `service`, or `alley` from measured width, length, and terminal status.
5. Fit the lane centerlines to the road with a 40px vehicle envelope. Narrow roads receive a smaller per-corridor lane offset and are marked `clearanceConstrained`.
6. Compile directed lanes, stop lines, turning movements, signal groups, terminal turnarounds, and roadblock references.
7. Reject invalid geometry, missing directed connectivity, sinks, or blocked lane envelopes.

The generated BIL network currently contains 372 corridors, 213 authored junctions, 3,084 compiled nodes, and 4,015 compiled edges. Of the 179 multi-lane corridors, 41 are classified as arterials and 138 as boulevards.

## Runtime policy

- `routePriority` makes through traffic prefer major roads when travel times are otherwise similar.
- `trafficDensity` weights ambient vehicle spawn distribution without making any legal edge unreachable.
- Per-edge occupancy is sampled once per server tick. New A* routes receive a bounded congestion multiplier, allowing traffic to distribute across alternatives without oscillating existing vehicles every frame.
- Passing and stuck recovery require heading-compatible lead traffic. An oncoming stopped vehicle remains a collision constraint instead of being mistaken for a recoverable obstacle.
- Closures remain hard constraints and override class or congestion preferences.
- The server owns the graph, routes, closures, and vehicle decisions. The editor and client only visualize compiled data.

## Editor workflow

Use **Generate full road network** after the road-cell layer is materially changed. Select a corridor to inspect or override its class, speed, lane spacing, lane offset, route priority, and traffic density. The canvas shows:

- class-colored authored centerlines;
- exact dashed compiled lanes for both directions;
- direction arrows;
- selected road clearance envelopes;
- junction stop lines and generated movement data.

Run **Validate** before Preview. A valid graph must have no blocked lane envelope, sink, missing movement, stale roadblock reference, or unreachable return path.

## Design boundary

The road-cell layer answers "where can a vehicle physically fit?" The lane graph answers "where should traffic drive and how can it legally get there?" Do not use visual road markings or sprite pixels directly at runtime; convert them into these authored and compiled contracts first.

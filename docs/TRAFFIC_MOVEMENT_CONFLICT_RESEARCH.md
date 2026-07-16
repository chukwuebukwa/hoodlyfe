# Traffic Movement Conflict Research

Date: 2026-07-16

Status: G2b.2b adaptation contract

## Question

NOCK0 currently grants one junction lease at a time. That is safe, but it serializes
movements that cannot touch, such as separated opposite-direction straight lanes or two
right turns around different corners. The next traffic slice must improve junction
throughput without weakening stop lines, signals, physical occupancy checks, rear
clearance, or authoritative collision.

The pinned re3 and reVC repositories are unlicensed reversed sources. They are read-only
educational behavior references; no source, identifiers, constants, or data tables are
copied.

## Primary-Source Findings

### Directed lane links are the movement identity

re3 stores direction, left/right lane counts, traffic-light ownership, and a one-way lane
offset on each car path link:

- [re3 `PathFind.h` lines 86-121](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/PathFind.h#L86-L121)

reVC preserves that structure while packing direction and width more explicitly:

- [reVC `PathFind.h` lines 103-128](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/PathFind.h#L103-L128)

Both engines therefore reason about a car's current, next, and previous directed links,
not only an intersection center.

### Signals apply to a directional stop window

re3 annotates nearby car links from map traffic-light objects, then tests the current,
next, and for physics vehicles previous link against direction and a bounded stop window:

- [re3 light-to-link annotation](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/TrafficLights.cpp#L137-L180)
- [re3 directional stop checks](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/TrafficLights.cpp#L204-L271)

reVC changes how light objects are matched to road links but retains the same directional
current/next/previous stop contract:

- [reVC light-to-link annotation](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/TrafficLights.cpp#L311-L371)
- [reVC directional stop checks](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/TrafficLights.cpp#L373-L445)

This means a green phase is permission to evaluate a movement, not permission to ignore
other vehicles or physical occupancy.

### Lane-aware curves remain separate from traffic speed policy

re3 derives current- and next-link lane positions, then feeds both positions and headings
into a curve:

- [re3 lane-aware curve construction](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L823-L850)

reVC continues to convert lights and nearby actors into a maximum traffic speed rather
than moving the car from the light or awareness systems:

- [reVC traffic/light speed constraint](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1177-L1195)
- [reVC pedestrian projected-contact scan](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1198-L1303)

The transferable boundary is directed movement geometry plus independent admission and
speed policy. Neither pinned source exposes a reusable movement-conflict matrix.

## Permissive Production Comparison

Eclipse SUMO models each lane-to-lane connection through a junction as an internal lane.
Each connection has a stable index plus `foes` and `response` bitsets. `foes` identifies
all conflicting streams; `response` identifies the higher-priority subset that forces the
movement to stop. SUMO also keeps physical internal lanes so vehicles can occupy and block
the junction instead of teleporting between stop lines:

- [SUMO road-network junction requests and internal lanes](https://sumo.dlr.de/docs/Networks/SUMO_Road_Networks.html#junctions-and-right-of-way)
- [SUMO intersection internal-link behavior](https://sumo.dlr.de/docs/Simulation/Intersections.html#internal-links)

NOCK0 does not need SUMO's full traffic simulator. The useful production pattern is:

1. give every authored lane-to-lane movement a stable identity and path;
2. derive a conservative symmetric foe relation;
3. keep priority/FIFO separate from physical conflict;
4. retain collision and blocked-junction checks after admission.

## NOCK0 Adaptation

### Movement descriptor

`TrafficRouteSystem` derives one movement while a car approaches a junction:

- entry lane edge;
- traversal edge or straight continuation;
- exit lane edge;
- turn class;
- entry and exit lane ownership;
- a short authored polyline through the conflict bounds;
- the current vehicle's half-width plus a safety margin.

The route triplet is private server AI state. Clients receive only the resulting vehicle
pose and opt-in debug geometry.

If the route is a road-cell fallback, route geometry is incomplete, or the movement is a
terminal U-turn, the descriptor is exclusive. Missing information fails closed.

### Foe policy

`traffic-junction-conflict-policy.ts` is pure. Two movements conflict when:

- either movement is exclusive;
- they share an entry lane or exit lane;
- they have the same movement identity; or
- any pair of movement-polyline segments comes within the sum of their swept half-widths.

Parallel authored lanes remain compatible only when their measured separation exceeds the
combined swept width. Left turns, crossing straights, shared merges, malformed geometry,
and U-turns remain exclusive or conflicting.

### Lease policy

`TrafficJunctionSystem` keeps a bounded owner set per junction. A request is admitted only
when:

- its signal, pedestrian, and unowned-occupant checks are clear;
- it conflicts with no active owner; and
- it does not bypass an older unblocked conflicting waiter.

Compatible waiters may proceed together. Conflicting waiters retain deterministic
arrival-time and vehicle-ID order. Once a car enters crossing or clearing, later blockers
cannot revoke its lease. Each owner renews and releases independently after rear
clearance.

The low-level driver ignores only active compatible owners, never every queued car.
Authoritative vehicle contact remains the final safety layer.

## Multiplayer and Netcode Boundary

- Movement selection, foe checks, FIFO, leases, signals, occupancy, and traffic AI run only
  on the district server.
- No client chooses a movement or grants a junction lease.
- Interaction-island replay continues to consume physical vehicle state and bounded applied
  intent only.
- Prediction, reconciliation, interpolation, AOI admission, island selection/replay,
  rewind, rollout, and shared movement/contact kernels remain unchanged.
- Debug movement paths are additive opt-in diagnostics and do not affect gameplay.

## Required Evidence

The checkpoint is complete only when tests prove:

- perpendicular straights and left-versus-opposing-straight conflict;
- separated parallel straights and disjoint right turns may coexist;
- shared entry/exit lanes and missing geometry fail closed;
- compatible owners acquire, renew, cross, clear, expire, and release independently;
- conflicting FIFO is stable while compatible traffic may bypass an unrelated stream;
- signals, pedestrians, unowned occupants, and terminal U-turns remain protected;
- controller integration can expose more than one safe owner at an authored junction;
- dense soak preserves zero or tightly bounded oriented-box overlap and improves or retains
  queue/traversal gates;
- F3 and Three diagnostics expose movement, owner count, conflicts, and active paths;
- typecheck, full suite, permanent netcode, strict impairment soak, build, frozen-netcode
  diff, and live Three QA pass.

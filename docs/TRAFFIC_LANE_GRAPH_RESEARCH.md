# Authored Lane Graph and Traffic Route Research

Date: 2026-07-15

Status: G2a implementation contract

## Scope

G2a replaces per-junction random road-cell wandering for the Industrial District with a
versioned, validated, directed lane graph and durable server-owned routes. It deliberately
does not claim to finish G2: time-to-collision awareness, lane arbitration, passing,
yielding, and deterministic multi-vehicle deadlock resolution remain G2b/G2c work.

This is an original TypeScript implementation informed by behavior visible in pinned
educational reference sources. No source code, identifiers, assets, or tuning tables were
copied.

Pinned references:

- re3 commit [`3233ffe1c4b99e8efb4c41c6794b4fce880cf503`](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)
- reVC commit [`b9eeb33efcd04a5b7a423921609baef11bf4719a`](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a)

## Source-Derived Behavior

### Route mission, driving style, temporary action, and controls are separate state

re3 stores a persistent car mission, driving style, temporary action with an expiry,
current/next/previous route and path nodes, current/next lanes, curve timing, and cruise
speed as separate autopilot fields. A reverse or swerve is therefore a bounded interruption
of a durable mission rather than a replacement for navigation:

- [re3 mission, temporary-action, and driving-style enums](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/AutoPilot.h#L7-L53)
- [re3 route, lane, mission, action, and speed runtime](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/AutoPilot.h#L55-L86)
- [re3 temporary actions translated to steering, throttle, brake, and handbrake](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L2058-L2156)

This is the main modularity invariant for NOCK0. `TrafficRouteSystem` owns the long-lived
route, `TrafficManeuverSystem` owns temporary recovery, `TrafficAwarenessSystem` owns the
current speed constraint, and `RoadDrivingSystem` produces low-level movement. The
room-facing `TrafficController` composes them but does not absorb their policy.

### The road representation carries driving semantics

re3 path nodes distinguish dead ends, disabled links, and links between levels. Car path
links carry direction, left/right lane counts, traffic-light metadata, and an offset used
to locate a specific lane:

- [re3 path-node flags](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/PathFind.h#L57-L84)
- [re3 directed car links, lane counts, lights, and lane offset](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/PathFind.h#L86-L121)

Route selection checks lane-legal turns, one-way direction, disabled/dead-end constraints,
and current/next lanes. It then derives lane-offset curve positions rather than steering
toward an undifferentiated road-cell center:

- [re3 lane-legal and one-way route selection](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L1510-L1605)
- [re3 lane transition and lane-offset curve positions](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L1607-L1674)

NOCK0 transfers the semantics, not the data format. Its JSON asset declares centerline
corridors, junction ownership, turn policy, speed limits, drive side, and terminal
turnaround policy. Compilation produces immutable directed lane, connector, and turnaround
edges with explicit vehicle-class admission.

### Recovery is timed and subordinate to the route

re3 detects sustained lack of progress, schedules a bounded reverse action, and can
temporarily escalate the driving style. The temporary action expires independently while
the mission remains intact:

- [re3 progress timers and bounded reverse recovery](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarAI.cpp#L367-L411)

G2a keeps NOCK0's existing reverse/recovery behavior but, after recovery, reprojects the
authoritative vehicle onto a legal directed lane and replans a durable route. G2b will
replace coarse proximity decisions with time-to-contact and swept oriented-box awareness.

### reVC expands policy without removing the layers

reVC retains the same mission/style/action/path/lane separation while adding more mission
types, a cruise-speed multiplier, and a switch-distance field:

- [reVC expanded mission set](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/AutoPilot.h#L8-L37)
- [reVC preserved layered runtime and additional speed policy](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/AutoPilot.h#L63-L97)
- [reVC effective cruise-speed accessor](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/AutoPilot.h#L127-L135)

The useful delta is architectural: richer traffic and pursuit behavior adds policy fields
and mission variants; it does not turn route planning, temporary maneuvers, and physical
control into one state machine.

## NOCK0 G2a Design

### Authored asset and compiler

`public/assets/maps/district-lanes.json` is schema version 1 and declares ten road
corridors plus twelve owned junctions. `LaneGraph` compiles those centerlines into 88
immutable right-hand lane nodes and 184 directed edges.

The authored lane-center offset is 24 pixels, producing 48 pixels between opposing
directions. That distance is intentionally larger than the widest 33-pixel vehicle
collider plus an 8-pixel safety margin. The original 14-pixel offset produced only 28
pixels of separation, so otherwise-correct opposing traffic overlapped and accumulated
collision damage while passing. A regression test now derives the required clearance from
the vehicle catalog instead of assuming sprite dimensions are physical dimensions.

Loading fails fast when it finds:

- unsupported schema versions, duplicate IDs, invalid points, or unknown corridors;
- a junction that does not lie on every corridor it claims;
- nodes or 32-pixel edge samples outside road/vehicle-clear space;
- sink nodes;
- a graph that is not strongly connected in both the forward and reverse reachability
  traversals.

The road-cell graph remains an explicit compatibility fallback for tests and future maps
that do not yet have a lane asset. It is not used as hidden repair for an invalid authored
district graph.

### Durable bounded route planning

`TrafficRoutePlanner` runs deterministic bounded A* over legal outgoing edges. Cost is
travel time derived from edge length and speed limit plus small turn/turnaround penalties.
The heuristic uses the graph's actual maximum speed, so it remains admissible when content
changes. A visit cap produces an explicit partial route and visited count rather than
unbounded server work or a disguised success.

`TrafficRouteSystem` owns destination choice, route revision, current/destination node,
progress, speed-limit lookup, debug waypoints, recovery reprojection, and virtual traffic
advance/capture. Destination selection uses named deterministic randomness and prefers a
meaningfully distant reachable node. A vehicle keeps that route until completion or
recovery; it does not choose a new branch every simulation tick.

### Population streaming

Active traffic and dormant potential traffic use the same authored graph:

- activation requests a legal lane spawn;
- dematerialization captures the closest heading-compatible lane edge;
- dormant coarse progress advances through legal outgoing directed edges;
- rematerialization restores a lane-owned spawn rather than inventing a road-cell heading.

This preserves route legality without keeping full steering or collision state active for
every virtual vehicle.

## Multiplayer Adaptation Contract

Traffic route AI is authoritative server gameplay.

- Clients never select destinations, run A*, choose turns, recover routes, or advance
  virtual traffic.
- The authored graph is presentation/debug content on the client; it does not grant
  authority.
- Ordinary Colyseus state continues to replicate vehicle pose and gameplay state through
  existing AOI rules.
- If a traffic vehicle enters a local interaction island, replay consumes only its physical
  state and the bounded last server-applied movement command. Route, style, maneuver,
  population, and AI policy do not execute during replay.
- Route completion, recovery, and virtual materialization cannot create replay side
  effects. Collision damage, crimes, missions, and durable transactions remain server-only.
- G2a changes no prediction, reconciliation, interpolation, AOI admission, island
  selection/replay, combat rewind, rollout, or shared movement/contact kernel.

## Debug and Acceptance Evidence

The opt-in F3 **Road graph** row reports graph schema, node/edge totals, routed and partial
vehicles, and route revisions. The Three debug overlay draws lane edges, connectors,
turnarounds, and each active route's remaining waypoints.

G2a is checkpoint-ready only when evidence proves:

- the real district graph validates and is strongly connected in both directions;
- opposing directions compile to opposite right-hand offsets;
- opposing lane centers clear the widest configured vehicle collider plus safety margin;
- route planning is deterministic, direction legal, bounded, and explicit when partial;
- route ownership is durable and replans only on completion or recovery;
- recovery returns to a legal lane;
- active/dormant population paths use authored graph adapters;
- a one-minute multi-car soak continues circulating;
- typecheck, full repository, permanent netcode, strict impairment soak, production build,
  real multiplayer, and live debug gates pass;
- the frozen netcode diff is empty.

## Deferred G2 Work

G2a does not solve traffic jams by itself. Next work should add, in order:

1. swept oriented-box and time-to-contact awareness against vehicles and pedestrians;
2. lane/intersection right-of-way arbitration with stable leases and hysteresis;
3. passing/yielding choices that preserve the durable route;
4. deterministic deadlock components, priority selection, bounded reverse space checks,
   cooldowns, and final safe virtualization/reset policy.

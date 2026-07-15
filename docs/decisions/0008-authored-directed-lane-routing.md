# ADR 0008: Authored Directed Lane Routing

Date: 2026-07-15

Status: Accepted for G2a

## Context

Ambient vehicles previously chose their next collision-grid road cell at each junction.
That gave them no durable destination, explicit direction, lane ownership, legal turn
contract, or route continuity across population virtualization. Adding avoidance and
deadlock policy on top of that representation would preserve the root ambiguity.

The interaction-island netcode is a frozen dependency. Route AI must remain authoritative
and cannot become part of client prediction merely because nearby vehicles can be promoted
as physical contact bodies.

## Decision

Use a versioned authored centerline asset compiled into an immutable directed lane graph.
Fail district startup when the authored graph is malformed, blocked, has sinks, or is not
strongly connected in both directions.

Keep traffic ownership separated:

- `LaneGraph`: content loading, compilation, validation, projection, and legal lane spawns;
- `TrafficRoutePlanner`: deterministic visit-bounded A* and explicit partial results;
- `TrafficRouteSystem`: destination, route progress, recovery replanning, and virtual
  traffic adapters;
- `TrafficAwarenessSystem`: current obstacle-derived speed constraint;
- `TrafficManeuverSystem`: bounded temporary recovery action;
- `TrafficJunctionSystem`: temporary junction ownership;
- `RoadDrivingSystem`: low-level steering, throttle, and braking;
- `TrafficController`: room-facing composition only.

Maps without authored lane content may use the existing road-cell compatibility adapter.
An invalid authored graph is not silently replaced by that fallback.

## Multiplayer Contract

Route selection, A*, destination state, recovery, and virtual traffic execute only on the
district server. Interaction-island replay may consume physical vehicle state and the last
authoritative movement command, but never runs traffic AI. No G2a file may change
prediction, reconciliation, interpolation, AOI, rewind, rollout, or shared movement/contact
kernels.

## Consequences

- Traffic has a stable destination and inspectable route instead of per-tick random turns.
- Active and virtualized traffic share one legal directed representation.
- G2b can reason about lanes, junctions, and time-to-contact without guessing direction
  from a road tile.
- Content authors must maintain and validate a graph for every production district.
- This milestone does not itself solve local avoidance or deadlocks; those remain separate
  policies layered below the durable route.

# ADR 0009: Junction Conflict-Zone Ownership

Date: 2026-07-15

Status: Accepted for G2b.1

## Context

Authored lanes made legal routes explicit, but the existing expiring boolean junction lock
released before a complete vehicle cleared and could expire during a slow crossing. Dense
traffic could therefore enter one physical conflict zone from multiple approaches and form
a collision chain. A reservation acquired far from the junction also reduced throughput.

The interaction-island netcode is already the physical prediction foundation. Traffic
right-of-way policy must not be duplicated inside replay or conflated with contact solving.

## Decision

Use a server-authoritative, deterministic FIFO lifecycle for authored junctions:

- queue near the authored junction center;
- admit one owner into `approach` only when the signal and physical conflict zone permit;
- keep a short commit window so an admitted car is not stopped after the line;
- transition through `crossing` while route nodes remain owned by the junction;
- transition to `clearing` at the outgoing node;
- release only after the vehicle center travels half its catalog length plus a margin beyond
  the exit point;
- renew the lease every update and use expiry only for abandoned ownership;
- expose phase, queue position, lease, and junction geometry through debug state.

Denied cars receive a virtual stop obstacle before the connector. Protected crossing and
clearing phases suppress maneuvers that could reverse or pull the owner sideways inside the
conflict zone.

Apply physical conflict-center admission only to authored lane graphs. The collision-grid
compatibility route cannot infer exact conflict geometry and retains its older coarse
behavior until it is replaced by authored content.

## Multiplayer Contract

The district server exclusively owns junction membership and transitions. Prediction may
replay resulting physical vehicle commands and contacts but never traffic policy. No change
to prediction, reconciliation, interpolation, AOI, interaction-island selection, rewind,
rollout, or shared movement/contact kernels is part of this decision.

## Consequences

- Crossing ownership matches the whole vehicle footprint rather than its center point.
- Player cars and other unqueued actors can block new entry without becoming queue owners.
- Deterministic queues prevent multiple approaches from repeatedly stealing admission.
- One-owner serialization is conservative; compatible turn classes cannot yet share a
  junction.
- Swept time-to-contact awareness and general deadlock resolution remain separate milestones.

# ADR 0014: Speed-Aware Population Lookahead

**Status:** Accepted
**Date:** 2026-07-15

## Context

ADR 0013 protects the union of current player positions, but a fast vehicle can consume much
of the prewarm ring before dormant records receive enough bounded materialization turns.
Increasing every radius would spend more simulation in all directions and worsen room-wide
active-cap pressure.

Pinned re3 and reVC instead widen pedestrian generation with player-vehicle speed and bias
traffic generation toward the velocity direction when the player is moving quickly. Their
visibility and collision rejection still prevents an ahead-biased candidate from appearing
on camera or inside occupied geometry.

## Decision

- Every street player contributes one real visibility-protecting anchor.
- At absolute authoritative vehicle speed 120 px/s or greater, the occupied vehicle also
  contributes one non-visibility lookahead anchor.
- Lookahead distance is signed speed multiplied by 1.5 seconds, clamped to 480 pixels.
  Reverse motion therefore projects behind the vehicle's authoritative heading.
- A lookahead anchor may admit and retain ambient actors, but it cannot classify space as
  visible or override the 720-pixel anti-pop-in guard around any real player.
- Lookahead is server-only population lifecycle policy. It does not enter client prediction,
  reconciliation, rewind, shared movement, or interaction-island selection.
- F3 Population reports the number of active lookahead anchors.

## Consequences

Fast players prewarm the road they are approaching without globally widening simulation or
allowing visible spawns. Stationary and on-foot players retain the original circular policy.
The projection follows authoritative state and may trail presentation by a simulation tick,
which is harmless at the selected 1.5-second horizon and avoids trusting client hints.

The room still needs per-interest-cluster quotas. A distant dense player group can otherwise
consume the room-global 40-pedestrian and 24-traffic active ceilings before another group is
serviced.

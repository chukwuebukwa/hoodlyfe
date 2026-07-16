# ADR 0015: Fair Population Interest Clusters

**Status:** Accepted
**Date:** 2026-07-15

## Context

ADR 0013 bounds active ambient population around the union of all street players, and ADR
0014 adds authoritative speed-aware lookahead. The room still has one global ceiling of 40
ambient pedestrians and 24 ambient traffic vehicles. A dense neighborhood can consume that
ceiling before a distant player group receives any population.

Pinned re3 and reVC use global pedestrian/vehicle pools, zone and road density, camera-aware
admission, speed-expanded generation distance, and deletability/visibility checks. Mission,
law-enforcement, emergency, damaged, and visible actors are protected from ordinary ambient
cleanup. Those references assume one focused player and do not contain a multiplayer cluster
allocator.

## Decision

- Real player and gameplay anchors are cluster seeds. Seeds belong to the same component
  when their 1,536-pixel retention envelopes overlap.
- Lookahead anchors attach to their owner's component and never create a component alone.
- Disconnected components receive equal deterministic shares of the 40-pedestrian and
  24-traffic ambient ceilings. Stable owner IDs determine remainder assignment.
- Materialization rotates across under-quota components instead of allowing the nearest
  component to consume the complete per-tick budget.
- Quotas are contention entitlements rather than hard ceilings. After current under-quota
  demand is served, a component may borrow otherwise idle room capacity.
- When a new distant component appears after capacity is full, the controller may stream out
  only offscreen, disposable, over-quota ambient actors. Rebalancing shares the existing
  bounded dematerialization budget and immediately makes the released slots available to the
  underfilled component.
- Hot, occupied, hijacked, mission-owned, burning, destroyed, damaged, combat-engaged, or
  otherwise pinned actors are never removed to satisfy a quota. A component may exceed its
  share and another may remain underfilled; diagnostics expose that pressure.
- Cluster selection, quotas, and lifecycle remain authoritative server population policy.
  They do not enter prediction, rewind, reconciliation, interaction-island selection, or
  shared movement/contact kernels.
- Component construction and capacity planning are separate pure policy modules. The
  streaming controller applies their plans and owns only actor lifecycle mutations.

## Consequences

Distant groups receive bounded ambient life without duplicating a complete population per
player. Joining, leaving, splitting, and merging converge over several ticks instead of
causing one-frame churn. Safety can temporarily defeat fairness, which is preferable to
visible despawns or deleting gameplay-owned state.

This is a room-cap allocator, not zone density. Zone/time profiles, non-player gameplay
anchors, durable ownership, and region transfer remain later G8 work.

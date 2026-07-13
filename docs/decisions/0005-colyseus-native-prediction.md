# ADR 0005: Retain Colyseus And Build Native Prediction

## Status

Accepted on 2026-07-12.

## Context

NOCK0 needs immediate local control, smooth remote motion, and responsive collisions among player-driven vehicles under internet latency. The project already uses Colyseus for authoritative rooms, schema replication, area-of-interest state views, reconnection, regional deployment, and integration with gameplay domains.

Lance, Netick Rocket Cars, SuperTuxKart, and Ring Racers were reviewed as possible implementations or references. None can be adopted without replacing major infrastructure, importing incompatible engine assumptions, or crossing licensing boundaries.

The current client predicts only the owned vehicle against static world collision. Dynamic vehicle contacts are server-only, so the predicted local body and contacted remote vehicles occupy different timelines.

## Decision

Keep Colyseus as the authoritative transport and room runtime.

Build a modular prediction layer in shared TypeScript with:

- one deterministic fixed-step vehicle simulation used by server and browser;
- bounded input and authoritative state histories;
- timestamped remote interpolation;
- a bounded prediction island for the owned vehicle and nearby collision-relevant vehicles;
- whole-island restore and resimulation from one authoritative tick;
- remote last-input hold and decay;
- render-only correction offsets;
- replay-side-effect suppression;
- server-owned gameplay outcomes.

Do not add Lance as a dependency. Do not copy or translate GPL implementation from SuperTuxKart or Ring Racers. Netick engine internals are closed and must be independently implemented.

## Consequences

- Existing district, replication, persistence, mission, economy, and deployment architecture remains intact.
- Vehicle simulation must become stricter and more deterministic than it is today.
- Authoritative snapshots must include enough physical state and last-applied input to reconstruct a short collision horizon.
- Dynamic prediction cost is bounded by prediction-island membership rather than total district population.
- The server never rewinds physical contacts; client contacts are provisional presentation until authority confirms outcomes.
- QA must include latency, jitter, replay cost, contact disagreement, and duplicate-side-effect budgets.

## References

See [`MULTIPLAYER_NETCODE_ENGINE_EVALUATION.md`](../MULTIPLAYER_NETCODE_ENGINE_EVALUATION.md)
and the generalized
[`WORLD_INTERACTION_NETCODE_ARCHITECTURE.md`](../WORLD_INTERACTION_NETCODE_ARCHITECTURE.md).

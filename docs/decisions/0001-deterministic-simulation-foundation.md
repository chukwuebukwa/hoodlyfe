# ADR 0001: Deterministic Simulation Foundation

Status: Accepted

Date: 2026-07-10

## Context

The playable prototype placed simulation time, random choices, collision candidates, collection mutation, AI, vehicles, combat, and wanted behavior directly in `DistrictRoom`. That was sufficient for the first multiplayer milestone, but refined pedestrian, traffic, and police systems would multiply global scans and order-dependent behavior.

Research into re3 showed the value of bounded world events, response budgets, scheduled population work, road graphs, and sectorized world queries. The relevant source is unlicensed reverse-engineered code, so NOCK0 uses only independently specified behavior and original implementations. See `docs/RE3_AI_RESEARCH.md`.

## Decision

NOCK0 uses four server simulation primitives:

1. `FixedStepClock` advances gameplay at 30 fixed steps per second and caps catch-up work.
2. `DeterministicRandom` produces keyed samples from named streams without depending on call order.
3. `SpatialIndex` provides stable, kind-filtered circle and AABB candidates for exact gameplay checks.
4. `DeferredCommandQueue` applies structural collection changes after simulation iteration.

Gameplay facts are published as typed `GameEvent` records. The initial event union covers damage, kills, crimes, and respawns and will become the input boundary for incidents, wanted state, missions, presentation, and observability.

## Integration

The initial room integration:

- replaces wall-clock gameplay timestamps with simulation time;
- replaces stateless sine-based room randomness with named keyed streams;
- indexes players, pedestrians, and vehicles by stable kind and ID;
- uses spatial candidates for vehicle impacts, vehicle interaction, projectile targets, and nearby police checks;
- keeps exact distance and segment checks after broad-phase queries;
- defers bullet removal until the lifecycle phase;
- emits typed damage, death, crime, and respawn events;
- preserves the current vehicle, player, NPC, projectile, and lifecycle phase order.

## Invariants

- The server remains authoritative.
- Fixed simulation time, not `Date.now()`, controls gameplay outcomes.
- A random decision declares a stable stream name and key.
- Spatial-query result order is stable by entity kind and ID.
- The spatial index is a broad phase; systems still perform exact collision, visibility, and policy checks.
- Systems do not mutate the collection they are currently iterating.
- Event records contain stable IDs and plain data, not object references.
- Catch-up work is bounded so a delayed room cannot enter an unbounded spiral.

## Consequences

Benefits:

- scenario failures can be replayed against stable time and random inputs;
- AI and combat queries can scale by local density rather than total entity count;
- future domain systems have explicit boundaries for facts and lifecycle changes;
- collection mutation is predictable across JavaScript runtime and schema behavior.

Costs:

- spatial memberships must be kept synchronized after movement and lifecycle changes;
- delayed processes may discard excess elapsed time instead of simulating an unlimited backlog;
- keyed randomness requires careful key selection;
- the room remains responsible for orchestration until each domain system is extracted.

## Source Alignment

The source study used these concepts, not code:

- [re3 world sectors and queries](https://github.com/daynz/GTAviceCity/blob/master/src/core/World.cpp)
- [re3 timed event list](https://github.com/daynz/GTAviceCity/blob/master/src/core/EventList.cpp)
- [re3 population work scheduling](https://github.com/daynz/GTAviceCity/blob/master/src/peds/Population.cpp)

NOCK0's implementation, interfaces, constants, tests, and terminology are original.

## Verification

- Unit tests cover fixed stepping, catch-up limits, keyed randomness, spatial movement/removal/filtering, deferred mutation, and event draining.
- The existing two-client multiplayer integration scenario passes.
- TypeScript compilation and the production browser build pass.

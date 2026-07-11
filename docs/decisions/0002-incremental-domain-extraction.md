# ADR 0002: Incremental Domain Extraction

Date: 2026-07-10

Status: Accepted

## Context

`DistrictRoom` began as a useful playable prototype, but it now coordinates network messages while also implementing players, combat, vehicles, traffic, NPC behavior, police, wanted heat, and lifecycle rules. Continuing to add features there would make deterministic tests, replay, tuning, and parallel development increasingly difficult.

A rewrite into a generic framework would stop gameplay progress and introduce abstractions before their real contracts are understood.

## Decision

Extract one gameplay domain at a time behind plain TypeScript APIs while preserving `DistrictRoom` as the simulation coordinator.

- Domain modules do not import Colyseus, Phaser, or `DistrictRoom`.
- Inputs and outputs use IDs and plain data.
- Cross-domain facts are published as typed game events.
- Every extracted policy has headless unit tests.
- The room adapts schema entities to domain inputs and applies authoritative outputs.
- Structural state mutation remains deferred to the lifecycle phase.
- Real-time simulation never awaits persistence, wallet, or chain operations.

The first extraction is incidents, witnesses, wanted heat, dispatch, and pursuit memory. Vehicle damage/collision is next because it is shared by player driving, traffic AI, police chases, missions, repair, and economy sinks.

## Consequences

- Features can be tested without starting a Colyseus server.
- Debug snapshots can expose each domain's decisions directly.
- Replay and load-test harnesses can reuse domain modules later.
- Some adapter logic remains in `DistrictRoom` temporarily.
- The room shrinks incrementally; it is not replaced in one risky change.

## Long-Term Boundary

The district room should eventually own admission, command validation, fixed-step ordering, state projection, reconnection, and transfer lifecycle only. Persistence and Robinhood Chain settlement sit behind asynchronous event consumers and never become simulation systems.

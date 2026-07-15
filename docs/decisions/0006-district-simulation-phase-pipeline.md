# ADR 0006: District Simulation Owns Fixed-Step Phase Order

Date: 2026-07-14

Status: Accepted

## Context

`DistrictRoom` has been reduced to dependency wiring and transport adaptation, but still
owns the complete fixed-step schedule. This hides phase contracts inside a private method,
makes order changes difficult to test, and provides no per-phase diagnostics. The upcoming
wanted, traffic, police, pedestrian, weapon, encounter, and population milestones all
depend on stable ordering and replay-safe side effects.

## Decision

Create a framework-independent `DistrictSimulation` under `server/game/world/`.

- The room owns Colyseus admission, validated message adaptation, patches, and controller
  construction.
- `DistrictSimulation` owns named fixed-step ordering, iteration over authoritative actor
  collections, history capture, event dispatch, snapshot capture, and lifecycle flush.
- A generic phase pipeline validates unique order, rejects reentrant execution, fails fast,
  and exposes bounded timing/failure diagnostics.
- Domain controllers retain their internal runtime and policy ownership.
- Shared prediction kernels remain separate pure functions; `DistrictSimulation` is not
  imported by the browser and does not execute during client replay.

This refines ADR 0004's schedule-adapter boundary: the room invokes one simulation facade
instead of directly scheduling every domain controller.

## Consequences

- Phase order becomes independently testable and debug visible.
- Future systems enter an explicit phase instead of adding another room-owned update call.
- The server remains a modular monolith with low-latency in-process calls.
- The simulation facade has many narrow ports because it composes the district. It may not
  absorb domain policy merely to reduce constructor wiring.
- A failed phase aborts the current fixed step; automatic partial-tick recovery is not
  attempted.

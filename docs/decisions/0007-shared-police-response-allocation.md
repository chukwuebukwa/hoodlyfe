# ADR 0007: Shared Police Response Allocation

Date: 2026-07-14

Status: Accepted for G1

## Context

NOCK0 currently assigns foot officers and cruisers in separate systems while a third
system independently chooses response-fleet size from one primary suspect. That structure
cannot guarantee fair bounded response across simultaneous wanted players.

The interaction-island netcode is a frozen dependency for systemic-gameplay milestones.
Police policy must not enter client prediction or replay.

## Decision

Introduce one server-only `PoliceResponseAllocationSystem` that owns assignment leases for
both foot officers and cruisers. It consumes authoritative snapshots and publishes stable
read-only assignments, aggregate demand, budget diagnostics, and assignment changes.

Keep these responsibilities separate:

- `WantedSystem`: heat and wanted level;
- `CrimeResponseController`: incident/report facade and allocator integration;
- `PoliceResponseAllocationSystem`: finite capacity, fairness, leases, replacement, and
  suppression;
- `PursuitMemory`: per-unit last-known-position search state;
- pedestrian and police-vehicle controllers: behavior and movement;
- `PoliceResponseFleetController`: spawn/stand-down admission from aggregate demand.

`DistrictRoom` only wires these owners. `DistrictSimulation` invokes the existing named
crime-response phase. Neither owns response policy.

## Consequences

- Assignment counts become derived and auditable.
- Multiple suspects share one explicit district pool.
- Unit replacement can be deterministic and resistant to oscillation.
- Fleet demand can reflect all identified suspects without spawning one private fleet per
  player.
- Debug subscribers can inspect the complete response decision.
- AI remains server authoritative and existing netcode behavior remains unchanged.

The allocator adds policy state and tests, but removes two conflicting assignment owners.
Larger districts can later provide different policy limits without changing AI or network
contracts.

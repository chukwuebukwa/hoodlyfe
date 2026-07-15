# Police Vehicle Pursuit Research

Date: 2026-07-10

Status update (2026-07-14): G1 replaced the pursuit slice's private cruiser assignment owner with `PoliceResponseAllocationSystem`, the shared finite foot/cruiser response allocator documented in `CRIME_WANTED_RESPONSE_BUDGET_RESEARCH.md`. The pursuit strategy, search-memory, routing, steering, and collision boundaries below remain current; references to `PoliceVehicleDispatchSystem` describe the original slice before that ownership migration.

This slice establishes one authoritative police cruiser pursuit without pretending that the current GTA2 compatibility road mask is a production lane network. The implementation is clean-room TypeScript informed by local reverse-engineered source structure. No source code was copied.

## Production References

Pinned local reference: `/tmp/nock0-GTAviceCity` at `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

- `src/control/AutoPilot.h` keeps a vehicle's route state, driving style, temporary recovery action, mission, destination, and cruise speed together but separate from wanted-state ownership.
- `src/control/CarAI.cpp` chooses law-enforcement strategy. It switches between far road-following and close pursuit, scales chase speed by wanted level, mellows low-level pursuit near a target, chooses blocking more often at low heat, and permits more ramming at high heat.
- `src/control/CarCtrl.cpp` executes route-node following, lane/link selection, close steering, obstruction response, and temporary reverse/turn recovery. Strategy selection does not perform low-level movement itself.
- `src/control/RoadBlocks.cpp` owns roadblock placement separately from ordinary pursuit steering.
- OpenGTA2's current runtime does not contain comparable police driving AI. Its useful contribution is map/junction data reading, not a production pursuit controller.

The reusable lesson is the boundary, not the 3D physics: dispatch facts, pursuit strategy, route planning, and steering execution are different responsibilities.

## Current Map Audit

The compatibility map's `roads` layer contains 1,861 road tiles across a 64x64 map.

- Five connected components exist.
- The largest component contains 1,757 tiles, or 94.4% of all road tiles.
- Node degree counts are 1 dead-end, 72 degree-two cells, 997 degree-three cells, and 791 degree-four cells.

Those high degree counts show that this is a broad binary road-surface mask, not authored lane centerlines. It can support bounded road-constrained pursuit and recovery. It cannot yet support correct one-way flow, lane changes, stop lines, signal ownership, parking, coordinated roadblocks, or polished intersection interception.

## Implemented Boundary

- `CrimeResponseController` remains the only owner that reads wanted state. It supplies reported location/time plus a current target pose used only for bounded line-of-sight perception.
- `PoliceResponseAllocationSystem` now owns stable foot/cruiser leases, wanted-tier quotas, district capacity, expired-report suppression, deterministic fairness, and assignment replacement across all simultaneous suspects.
- `police-vehicle-policy.ts` owns pure wanted-tier strategy, speed, and visible-vehicle lead calculations.
- `PoliceVehicleController` executes its shared assignment and composes policy, pursuit memory, route cadence, steering, siren state, and diagnostics.
- `RoadRoutePlanner` owns deterministic bounded A*. It returns complete routes or explicit partial progress when its visit budget is exhausted.
- `RoadDrivingSystem` owns shared road-constrained steering, acceleration/braking, ahead-corridor awareness, obstacle policy, and off-road rejoin. Ambient `TrafficController` still owns random cruising and recovery decisions.
- `VehicleSimulationController` remains the sole owner of impacts, car-to-car collision, damage, fire, destruction, occupants, and replication.
- `DistrictRoom` only wires these owners into the fixed-step schedule.

The cruiser starts from a validated road point. It does not receive omniscient destinations: a report creates search memory, line of sight upgrades that memory to live pursuit, and nine seconds without observation expires the report. A newer witness report can dispatch the cruiser again.

## Strategy Policy

- Heat 1 uses restrained pursuit/interception and slows near an on-foot suspect.
- Heat 2 raises pursuit speed while retaining obstacle awareness.
- Heat 3-5 permits a ram strategy only against an occupied target vehicle; the target car can be ignored by following-distance policy so collision remains the authoritative ram result.
- Visible occupied vehicles receive a short velocity lead, while unseen targets use only last-known coordinates.
- Hijacking immediately disables the siren and yields control. A player-driven cruiser uses ordinary player handling.
- A nearby active siren cruiser now prevents wanted decay just like a nearby foot officer.

## Diagnostics and QA Contract

F3 exposes each cruiser strategy, suspect, line of sight, desired speed, obstacle, bounded visited-node count, remaining route, and last-known point. The panel always reports `Cruisers active/total strategy`, so off-camera behavior is still visible.

Automated scenarios cover deterministic shortest routes, bounded partial routes, reported-position search without live-position cheating, visible high-heat ram escalation, report expiry, and hijack handoff. Live two-client QA created heat through normal movement, aim, projectile, witness, and vehicle-entry commands. The browser observed `Cruisers 1/1 intercept`, an active foot pursuit, replicated getaway-car damage, and clean return to `0/1 idle` after suspect cleanup.

## Deferred Production Depth

The next driving data gate is an authored versioned lane graph with direction, centerlines, legal turns, stop lines, signal/intersection ownership, parking/spawn points, and disconnected-route validation. On that foundation, add:

1. multiple unit allocation and district response budgets;
2. blocking/intercept positions coordinated across cruisers;
3. siren yielding and emergency traffic priority;
4. disabled-car avoidance and deterministic reverse/turn recovery;
5. officer occupants who exit stopped cruisers;
6. roadblock planning at high heat;
7. off-camera unit spawning and population level of detail.

Until lane metadata exists, the first cruiser remains a playable foundation rather than a claim of finished police driving AI.

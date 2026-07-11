# Street Streaming and Traffic Flow

Date: 2026-07-11

Primary behavioral reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

## Production Findings

The re3 traffic implementation does not solve density by spawning fewer cars. It combines directed path links, lane counts and offsets, legal turn links, traffic-light semantics, local obstacle speed policy, temporary driving actions, and offscreen cleanup. Simplified and full-physics vehicles have different simulation costs, while mission, player, damaged, and interesting vehicles are protected from ordinary cleanup.

NOCK0 keeps a clean-room TypeScript implementation. The reference establishes missing ownership and behavior, not copied code or tuning.

## Implemented Streaming Model

- `DistrictReplicationController` applies per-client street area of interest. Street actors enter at 1,280 pixels and leave at 1,536 pixels, preventing boundary churn.
- Same-space players and services remain visible. Occupied vehicles and participant mission targets are pinned regardless of distance.
- Adds and removes are budgeted per patch. Complete-state delivery for newly attached schemas remains explicit.
- `PopulationStreamingController` owns 80 pedestrian and 64 traffic records without materializing all 144 entities.
- Population materializes within 1,536 pixels and dematerializes beyond 1,920 pixels, with per-tick operation budgets and active ceilings of 40 pedestrians and 24 traffic cars.
- Dormant records advance coarse route or wander state. Combat pedestrians and occupied, damaged, burning, destroyed, or mission-owned vehicles remain materialized.
- `DistrictPopulationController` now creates persistent pedestrians and parked/service vehicles in the live room but does not create a second ambient traffic population.

Network observation and simulation activation remain separate policies. A client view never decides whether an entity exists.

## Traffic Flow Corrections

- Opposing traffic follows opposite right-hand offsets from the compatibility road-cell centerline.
- Junctions use deterministic arrival queues and one expiring reservation. A stuck owner cannot refresh ownership forever.
- Red-light queues remain legitimate stops. Cars do not reverse or pass them.
- World-blocked cars wait 1.2 seconds, reverse for up to 650 ms only through valid road/collision space, then select a deterministic alternate edge.
- Cars stopped behind a stationary vehicle use a bounded reverse, side pass, and merge plan. A directly blocking pedestrian gets a shorter side detour; a pedestrian or signal protecting a queue prevents unsafe passing.
- Ambient pedestrian spawning and wandering prefer non-road cells. A pedestrian already on a road may still leave it.
- Streamed traffic checks separation at its actual lane-offset position before materializing.

## Vehicle Collision Shape

The spatial index uses a catalog-derived bounding circle only for broad-phase discovery. The authoritative narrow phase uses oriented rectangles with per-model length and width, separating along the minimum SAT overlap axis before applying momentum and damage. This prevents the previous circular collider from accepting false corner contacts and gives side/nose collisions the correct contact normal.

## Diagnostics and QA

F3 reports average visible versus world entities, queued view changes, active versus potential population, pinned population, traffic reason, obstacle, maneuver phase, and recovery count.

Coverage includes hysteresis, view budgets, pinning, materialization limits, junction expiry, opposite lane offsets, red-light suppression, pedestrian detours, reverse/replan timing, oriented-box contacts, and a deterministic one-minute 24-car circulation soak.

## Remaining Production Work

The compatibility map still exposes broad undirected road cells. Lane offsets reduce head-on conflicts but cannot infer every legal lane, stop line, merge, turn radius, parking bay, or vehicle-class restriction. The durable content upgrade is an authored, versioned directed lane graph with connector occupancy and segment capacity. Until then, active ceilings and recovery remain safety bounds rather than substitutes for road authoring.

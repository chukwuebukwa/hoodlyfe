# Reusable Freemode Mission Objective Research

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference separates the mission program, reusable world predicates/commands, and mission-owned cleanup.

- Every running script owns instruction position, local variables, timers, wake time, condition state, mission flags, and death/arrest policy. Mission state is isolated from global engine systems.
- Script commands expose reusable predicates and effects such as locating a vehicle, checking a vehicle in an area, adding entity/coordinate blips, assigning a mission-garage target, querying drop-off completion, and registering pass/fail statistics.
- Mission scripts compose those primitives with explicit branches and waits; vehicle, wanted, radar, garage, and world systems retain their own behavior.
- `CMissionCleanup` is a bounded ownership registry. Terminal cleanup restores temporary global policies and disposes or releases each tracked car, pedestrian, and object.
- Script work is bounded by explicit wake/timer progression rather than allowing one mission to run an uncontrolled loop inside the frame.

References:

- [`Script.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script.h)
- [`Script.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script.cpp)
- [`Script2.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script2.cpp)
- [`Script3.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script3.cpp)
- [`Script5.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script5.cpp)

NOCK0 uses original TypeScript contracts, templates, formulas, names, route generation, and tests. The reference informs ownership and missing production nuance only.

## Implemented Boundaries

### Shared Mission Catalog

`shared/content/mission-catalog.ts` owns stable template IDs, display copy, base reward, duration, formation limit, crew cap, and an ordered objective definition list. Server and browser consume the same immutable definitions; neither switches on asset filenames or Rockstar identifiers.

Current objective kinds:

- `acquire-vehicle`: exact reserved target must be occupied by a connected crew member;
- `vehicle-checkpoints`: the occupied target must cross ordered authoritative route zones;
- `clear-wanted`: maximum wanted level across connected crew members must reach zero;
- `deliver-vehicle`: the occupied target must enter the destination under the configured speed cap, with an optional continuous wanted gate.

### Pure Objective Evaluation

`MissionObjectiveSystem` receives one small template, bounded progress indexes, and a plain world snapshot. It advances satisfied objectives in a loop bounded by the template objective count, returns only the next active objective/phase or terminal completion, and never imports room, schema, economy, combat, police, traffic, Phaser, or persistence code.

Ordered checkpoints advance one step per authoritative update and cannot be skipped by touching a later zone. A delivery wanted gate can temporarily project `lose-heat` without rewriting objective data; clearing heat resumes the same delivery predicate.

### Freemode Runtime and Room Adapter

`MissionSystem` retains roster formation, participant activity/deaths, deterministic leader transfer, deadlines, target reservation, objective indexes, condition reward, terminal payouts, and removal. It delegates objective meaning to the evaluator.

`FreemodeMissionController` remains the district adapter. It selects/reserves an ambient target, creates deterministic road-safe route checkpoints for templates that request them, projects the current objective, publishes events/notices, applies payout through the economy port, and releases mission entities through `MissionEntityScope`. `DistrictRoom` only validates and forwards a template ID.

The client receives stable template/objective IDs plus only the current checkpoint coordinate/radius. The private future route is not replicated. Pure presentation policy derives offer title/summary/reward, active objective copy, world zones, and minimap points. The Phaser controller only draws and sends actions.

## Current Jobs

### Boost and Deliver

1. Acquire the exact reserved traffic vehicle.
2. Clear crew wanted heat when present.
3. Deliver at low speed; renewed heat gates delivery again.

Base reward: $750, reduced by target vehicle condition.

### Getaway Run

1. Acquire the exact reserved traffic vehicle.
2. Drive it through three deterministic ordered road checkpoints while ordinary traffic, police, and unrelated players remain active.
3. Clear crew wanted heat.
4. Deliver at low speed; renewed heat gates delivery again.

Base reward: $1,100, reduced by target vehicle condition.

Both use the same opt-in nearby crew formation, explicit/automatic roster lock, leader transfer, individual-death tolerance, target failure, timeout, abandonment, payout idempotency, terminal retention, and entity cleanup.

## Deferred Objective Modules

- Reach zone on foot or in allowed vehicle classes.
- Acquire/deliver inventory item or world object through a future item domain.
- Eliminate target through combat events rather than polling health fields.
- Hold area with contested presence, contribution time, and respawn-safe rules.
- Multi-vehicle race checkpoints, placement, false starts, catch-up policy, and finish ordering.
- Escort/protect target, survive timer, tail without detection, and defend moving convoy.
- Per-objective timers, optional branches, parallel role objectives, checkpoints/retry, and explicit failure predicates.
- Contribution thresholds and anti-idle payout eligibility.

These additions must extend objective input/output contracts or typed events. They must not add combat, police, vehicle, or inventory mutations to mission code.

## Acceptance Coverage

- Catalog definitions are bounded, complete, cycle deterministically, and have unique objective IDs.
- Acquire and wanted objectives skip only when their authoritative predicates are satisfied.
- Ordered checkpoints require target occupancy and cannot be completed out of order.
- Delivery requires occupancy, location, speed, and wanted policy.
- Existing Boost behavior, participant rules, failures, condition payout, idempotency, and cleanup remain green.
- Getaway Run completes acquire, all three generated collision-safe checkpoints, heat escape, delivery, payout, and schema projection through the real room adapter.
- Real two-client mission/combat/vehicle/passenger/respawn integration remains green.
- Full suite passes 105/105 and the production build passes.
- Live desktop and 390x844 browser QA verifies selector fit, chosen-template start, automatic roster lock, active target marker, abandonment cleanup, and zero new warning/error.

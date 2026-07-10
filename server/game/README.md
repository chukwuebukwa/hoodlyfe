# Server Game Modules

This directory contains authoritative simulation code that is independent of Colyseus room lifecycle and browser presentation.

## Dependency Direction

```text
DistrictRoom
  -> game domain systems
    -> game/world primitives
    -> game/events contracts
  -> Colyseus schema state
```

Rules:

- `DistrictRoom` orchestrates phases and network commands; it should not become the permanent home of new gameplay rules.
- Domain systems may depend on `game/world` and `game/events`.
- World primitives must not import `DistrictRoom`, Phaser, Express, or Colyseus schema classes.
- Event contracts use stable IDs and plain data.
- Browser animation and effects consume replicated state or messages and never decide gameplay outcomes.
- Collection additions and removals during iteration go through the deferred lifecycle queue.
- Random gameplay decisions use a named deterministic stream and a stable key.
- Spatial gameplay queries go through the shared index and retain exact final geometry checks.

## Current Modules

```text
game/
  events/
    game-events.ts
  incidents/
    crime-policy.ts
    incident-registry.ts
    witness-system.ts
  police/
    crime-response-controller.ts
    dispatch-system.ts
    pursuit-memory.ts
  missions/
    freemode-mission-controller.ts
    mission-entity-scope.ts
    mission-state-projector.ts
    mission-system.ts
  wanted/
    wanted-system.ts
  vehicles/
    vehicle-access-controller.ts
    vehicle-collision-system.ts
    vehicle-config.ts
    vehicle-damage-system.ts
  world/
    deferred-command-queue.ts
    deterministic-random.ts
    fixed-step-clock.ts
    spatial-index.ts
```

## Simulation Order

The current compatibility order is:

1. rebuild spatial memberships from authoritative state;
2. update vehicles and traffic;
3. update players and actions;
4. resolve due witness reports and district dispatch assignments through `CrimeResponseController`;
5. update pedestrians and police pursuit/search behavior;
6. move and resolve projectiles;
7. advance shared Freemode mission instances through `FreemodeMissionController`;
8. expire incidents and flush deferred lifecycle commands;
9. drain the tick's typed events for downstream consumers.

As systems are extracted, retain an explicit order in `DistrictRoom` and queue structural mutations until the lifecycle phase.

## Extraction Status

Extracted domain policies and room adapters now include:

- `incident-registry.ts` for bounded, expiring world incidents;
- `witness-system.ts` for perception and reporting;
- `wanted-system.ts` for per-suspect heat and response tiers;
- `police/dispatch-system.ts` for district capacity and assignments.
- `pursuit-memory.ts` for visible pursuit and last-known-position search state.
- `crime-response-controller.ts` as the room-facing facade over incident, witness, wanted, dispatch, and pursuit modules;
- `mission-system.ts` for plain deterministic group mission state and transitions;
- `freemode-mission-controller.ts` for target selection, schema projection, typed events, reward idempotency, and cleanup;
- `mission-entity-scope.ts` for bounded mission ownership and deterministic release/despawn records.
- `vehicle-access-controller.ts` for proximity selection, enter/hijack timing, seating, passenger promotion, exits, and player cleanup.

`DistrictRoom` now calls the crime and Freemode controller facades from an explicit fixed-step schedule. It no longer owns crime registration, witness selection, wanted mutation, police assignment, mission formation, objective transitions, payouts, or mission cleanup. Vehicle/traffic, combat/projectile, player lifecycle, and pedestrian adapters remain extraction work. New features must enter through an existing controller or add a new domain owner; they must not add another gameplay method to the room.

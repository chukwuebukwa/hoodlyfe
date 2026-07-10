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
    dispatch-system.ts
    pursuit-memory.ts
  wanted/
    wanted-system.ts
  vehicles/
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
4. resolve due witness reports and dispatch assignments;
5. update pedestrians and police pursuit/search behavior;
6. move and resolve projectiles;
7. expire incidents and flush deferred lifecycle commands;
8. drain the tick's typed events for downstream consumers.

As systems are extracted, retain an explicit order in `DistrictRoom` and queue structural mutations until the lifecycle phase.

## Extraction Status

The first gameplay domain extraction is active:

- `incident-registry.ts` for bounded, expiring world incidents;
- `witness-system.ts` for perception and reporting;
- `wanted-system.ts` for per-suspect heat and response tiers;
- `police/dispatch-system.ts` for district capacity and assignments.
- `pursuit-memory.ts` for visible pursuit and last-known-position search state.

`DistrictRoom` currently adapts schema entities into these plain-data APIs. Vehicle collision and damage math now lives in `game/vehicles/`; destruction, occupant ejection, and state projection remain room adapters until lifecycle extraction has another concrete consumer. Pedestrian behavior/perception and mission scope are the next server domains. New features should not add another unrelated behavior block to the room.

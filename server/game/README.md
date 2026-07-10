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
  combat/
    damage-controller.ts
    fire-control-controller.ts
    projectile-controller.ts
  debug/
    debug-snapshot-controller.ts
  economy/
    street-economy-controller.ts
  interactions/
    player-interaction-controller.ts
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
  population/
    district-population-controller.ts
  services/
    street-service-controller.ts
  players/
    player-control-controller.ts
    player-lifecycle-controller.ts
  traffic/
    traffic-awareness-system.ts
    traffic-controller.ts
  missions/
    freemode-mission-controller.ts
    mission-entity-scope.ts
    mission-state-projector.ts
    mission-system.ts
  pedestrians/
    pedestrian-behavior-system.ts
    pedestrian-controller.ts
    pedestrian-intent.ts
    pedestrian-locomotion-system.ts
    pedestrian-navigation-system.ts
    pedestrian-path-planner.ts
    pedestrian-perception-system.ts
    pedestrian-reaction-system.ts
    pedestrian-runtime.ts
    pedestrian-stimulus-adapter.ts
    pedestrian-stimulus-registry.ts
  wanted/
    wanted-system.ts
  vehicles/
    vehicle-access-controller.ts
    vehicle-collision-system.ts
    vehicle-config.ts
    vehicle-damage-system.ts
    vehicle-simulation-controller.ts
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
- `traffic-awareness-system.ts` for pure bounded ahead-corridor scanning, following/stopping speed policy, and inspectable limiting obstacles; `traffic-controller.ts` for ambient route state, deterministic turn/recovery selection, model-aware asymmetric cruise/braking, hijack braking, and release.
- `shared/content/vehicle-catalog.ts` for immutable model IDs, seating, footprint, health, mass, player handling, traffic tuning, and presentation metadata consumed by server and client adapters.
- `vehicle-simulation-controller.ts` for catalog-driven authoritative handling, occupant projection, pedestrian impacts, car collisions, mechanical damage, fire, destruction, restoration, and mission return-to-traffic.
- `fire-control-controller.ts` for authoritative holder state, seat rules, cooldown, ammunition, spread, pellet count, muzzle origin, and bullet creation.
- `projectile-controller.ts` for lifetime, swept movement, target-family collision, source exclusion, damage routing, and deferred removal.
- `damage-controller.ts` for player/NPC health, damage/death events, crime translation, threat response, and street-cash rewards.
- `debug-snapshot-controller.ts` for bounded typed-event summaries, six-tick sampling, plain protocol projection, incident/pursuit/pedestrian-stimulus copies, simulation pressure counters, and debug transport publication.
- `street-economy-controller.ts` for bounded idempotent session street-cash credits/debits, balance validation/caps, typed audit events, and a replaceable future persistence port.
- `street-service-controller.ts` for deterministic replicated service placement, authoritative eligibility, shared quotes, debit-before-effect coordination, and player notices.
- `player-interaction-controller.ts` for contextual service-first routing, vehicle-action fallback, and same-tick duplicate suppression.
- `district-population-controller.ts` for idempotent map bootstrap, mission-contact placement, deterministic pedestrian/parked/traffic composition, authoritative vehicle initialization, and traffic registration.
- `player-control-controller.ts` for per-player move intent, hostile wire-value normalization, aim gating, shared driver input, analog/diagonal magnitude, state-gated on-foot movement, collision resolution, reset, and disconnect cleanup.
- `player-lifecycle-controller.ts` for death, vehicle/wanted/input cleanup, respawn timing/location, health, ammunition, and respawn events.
- `pedestrian-controller.ts` for pedestrian spawn/ejected-driver/death/respawn lifecycle and room-facing composition.
- `pedestrian-runtime.ts` for private objectives, threat memory, think/fire/navigation deadlines, and respawn state.
- `pedestrian-perception-system.ts` for police pursuit observations and expiring civilian last-known-threat memory.
- `pedestrian-behavior-system.ts` for explicit ambient/police intent, independent authoritative aim, and fire cadence.
- `pedestrian-reaction-system.ts` for civilian orient/respond/recover transitions and `pedestrian-intent.ts` for the shared output contract consumed by locomotion/presentation projection.
- `pedestrian-navigation-system.ts` for private route ownership, per-tick request budgets, deterministic blocked recovery, and planner composition; `pedestrian-path-planner.ts` for bounded deterministic collision-grid A* with clearance and smoothing; plus `pedestrian-locomotion-system.ts` for continuous per-axis collision movement.
- `pedestrian-stimulus-registry.ts` for bounded, expiring, deduplicated sensory facts and `pedestrian-stimulus-adapter.ts` for translating stable cross-domain game events without importing producer systems.

`DistrictRoom` now calls domain facades from an explicit fixed-step schedule. It no longer owns crime registration, witness selection, wanted mutation, police assignment, mission formation, objective transitions, payouts, vehicle access/physics, traffic routes, combat/projectiles, player control/lifecycle, pedestrian runtime/behavior, district population assembly, or debug projection. The remaining room code is dependency wiring, Colyseus command/lifecycle adaptation, explicit simulation scheduling, spatial projection, and client transport. Client presentation remains extraction work. New features must enter through an existing controller or add a new domain owner; they must not add another gameplay method to the room.

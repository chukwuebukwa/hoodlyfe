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
  appearance/
    wardrobe-inventory-controller.ts
  combat/
    combat-reaction-controller.ts
    combat-survivability-policy.ts
    damage-controller.ts
    explosion-controller.ts
    fire-control-controller.ts
    melee-combat-controller.ts
    melee-hit-policy.ts
    projectile-controller.ts
    thrown-projectile-controller.ts
  debug/
    debug-snapshot-controller.ts
  economy/
    street-economy-controller.ts
  interactions/
    player-interaction-controller.ts
  medical/
    medical-care-controller.ts
  events/
    game-events.ts
  incidents/
    crime-policy.ts
    incident-registry.ts
    witness-system.ts
  police/
    crime-response-controller.ts
    police-response-allocation-system.ts
    police-response-fleet-controller.ts
    police-vehicle-controller.ts
    police-vehicle-policy.ts
    pursuit-memory.ts
  pickups/
    weapon-pickup-controller.ts
  population/
    district-population-controller.ts
    population-streaming-controller.ts
  replication/
    district-replication-controller.ts
    street-streaming-policy.ts
  services/
    street-service-controller.ts
  players/
    player-appearance-controller.ts
    player-control-controller.ts
    player-lifecycle-controller.ts
  traffic/
    lane-graph.ts
    traffic-route-planner.ts
    traffic-route-system.ts
    traffic-awareness-system.ts
    traffic-controller.ts
    traffic-junction-system.ts
    traffic-maneuver-system.ts
  missions/
    freemode-mission-controller.ts
    mission-entity-scope.ts
    mission-objective-system.ts
    mission-reward-policy.ts
    mission-state-projector.ts
    mission-system.ts
  pedestrians/
    pedestrian-behavior-system.ts
    pedestrian-controller.ts
    pedestrian-intent.ts
    pedestrian-locomotion-system.ts
    pedestrian-melee-system.ts
    pedestrian-navigation-system.ts
    pedestrian-path-planner.ts
    pedestrian-perception-system.ts
    pedestrian-reaction-system.ts
    pedestrian-runtime.ts
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
    district-simulation.ts
    fixed-step-clock.ts
    simulation-phase-pipeline.ts
    spatial-index.ts
    world-stimulus-adapter.ts
    world-stimulus-registry.ts
```

## Simulation Order

`DistrictSimulation` owns the tested 30 Hz order: frame state, activation/streaming,
environment, vehicle motion, player motion, crime response, pedestrian motion, dynamic
contacts, history capture, projectiles, world effects, pickups, incidents/missions,
lifecycle mutation, event dispatch, then snapshots/observability. `DistrictRoom` invokes
that facade and retains transport, admission, command adaptation, and composition only.

Events are drained once after authoritative simulation. `WorldStimulusAdapter` translates
eligible results into facts perceived on the next fixed step. Structural mutation remains
deferred until the lifecycle phase.

## Extraction Status

Extracted domain policies and room adapters now include:

- `incident-registry.ts` for bounded, expiring world incidents;
- `witness-system.ts` for perception and reporting;
- `wanted-system.ts` for per-suspect heat and response tiers;
- `police-response-allocation-system.ts` for one bounded, deterministic district response pool shared by foot officers and cruisers, with per-suspect quotas, stable leases, materially-better replacement, report suppression, and diagnostics.
- `pursuit-memory.ts` for visible pursuit and last-known-position search state.
- `crime-response-controller.ts` as the room-facing facade over incident, witness, wanted, shared response allocation, and foot-pursuit modules;
- `mission-system.ts` for plain deterministic group roster, reservation, deadline, objective-progress, payout, and terminal transitions;
- `mission-objective-system.ts` for bounded reusable acquire-vehicle, ordered-checkpoint, wanted-clear, and delivery predicates, plus `mission-reward-policy.ts` for condition-sensitive payout calculation;
- `shared/content/mission-catalog.ts` for immutable job definitions, presentation metadata, ordered objective composition, and template cycling;
- `freemode-mission-controller.ts` for template validation, target selection, deterministic road-safe checkpoint generation, schema projection, typed events, economy payout, and cleanup;
- `mission-entity-scope.ts` for bounded mission ownership and deterministic release/despawn records.
- `vehicle-access-controller.ts` for proximity selection, enter/hijack timing, seating, passenger promotion, exits, and player cleanup.
- `lane-graph.ts` for schema-versioned authored centerline compilation, immutable directed
  right-hand lanes/connectors/turnarounds, geometry and strong-connectivity validation,
  legal spawn/projection, and coarse virtual advance/capture.
- `traffic-route-planner.ts` for deterministic visit-bounded lane A* with explicit partial
  results; `traffic-route-system.ts` for durable destinations, route progress, speed-limit
  lookup, recovery reprojection, diagnostics, and population-streaming adapters.
- `traffic-predictive-contact.ts` for pure swept oriented-box contact timing;
  `traffic-awareness-system.ts` for bounded catalog-footprint following and time-to-contact
  speed policy with inspectable limiting obstacles;
  `traffic-controller.ts` composes route, junction, maneuver, emergency-yield, and driving
  owners while retaining hijack and blockage orchestration.
- `road-driving-system.ts` for shared road-constrained steering/acceleration/awareness execution and `road-route-planner.ts` for deterministic visit-bounded road-cell A* with explicit partial routes.
- `police-response-fleet-controller.ts` for realizing the allocator's aggregate cruiser demand without owning suspect selection; `police-vehicle-policy.ts` for pure strategy/speed/lead calculations; and `police-vehicle-controller.ts` for assignment execution, private visibility/search memory, bounded replanning, steering composition, siren/hijack handoff, and F3 diagnostics.
- `shared/content/vehicle-catalog.ts` for immutable model IDs, seating, footprint, health, mass, player handling, traffic tuning, and presentation metadata consumed by server and client adapters.
- `vehicle-simulation-controller.ts` for catalog-driven authoritative handling, occupant projection, pedestrian impacts, car collisions, mechanical damage, fire, destruction, restoration, and mission return-to-traffic.
- `fire-control-controller.ts` for authoritative holder state, seat rules, cooldown, ammunition, primary-attack family dispatch, spread, pellet count, muzzle origin, and bullet creation.
- `melee-combat-controller.ts` for per-player combo progression, accepted swing runtime, server-owned impact timing, facing assistance, target-family caps, and existing damage-port requests; `melee-hit-policy.ts` for pure line-of-sight-aware range/arc scoring and deterministic ordering.
- `projectile-controller.ts` for lifetime, swept movement, target-family collision, source exclusion, damage routing, and deferred removal.
- `combat-survivability-policy.ts` for pure armor-before-health resolution and force/family/direction reaction selection; `combat-reaction-controller.ts` for bounded replicated flinch/stagger/knockdown runtime and player-action interruption.
- `damage-controller.ts` for player/NPC armor/health mutation, split damage/death events, reaction requests, crime translation, threat response, and street-cash rewards.
- `debug-snapshot-controller.ts` for bounded typed-event summaries, six-tick sampling, plain protocol projection, incident/pursuit/world-stimulus copies, phase timing, simulation pressure counters, and debug transport publication.
- `street-economy-controller.ts` for bounded idempotent session street-cash credits/debits, balance validation/caps, typed audit events, and a replaceable future persistence port.
- `street-service-controller.ts` for deterministic replicated service placement, authoritative eligibility, shared quotes, debit-before-effect coordination, and player notices.
- `medical-care-controller.ts` for registered safe hospitals, private public/trauma admissions, nearest-facility completion, living treatment, and idempotent economy coordination.
- `wardrobe-inventory-controller.ts` for private namespaced grants, owner-only snapshots, and equipped-style entitlement checks without public inventory replication.
- `player-interaction-controller.ts` for contextual service-first routing, vehicle-action fallback, and same-tick duplicate suppression.
- `district-population-controller.ts` for idempotent map bootstrap, mission-contact placement, deterministic pedestrian/parked/traffic composition, authoritative vehicle initialization, and traffic registration.
- `population-streaming-controller.ts` for potential population records, bounded near-player materialization, far dematerialization, coarse dormant progress, active ceilings, gameplay pinning, and rate-limited invisible-jam retirement; `traffic-jam-retirement-policy.ts` owns the pure AOI/stationary/blocker ranking policy.
- `street-streaming-policy.ts` plus `district-replication-controller.ts` for client AOI hysteresis, deterministic add/remove budgets, same-space visibility, and occupied/mission vehicle retention.
- `traffic-junction-system.ts` for deterministic FIFO approach, crossing, and rear-clearance
  ownership with an abandonment lease; `traffic-maneuver-system.ts` owns bounded
  reverse/pass/merge recovery without bypassing protected queues.
- `vehicle-collision-system.ts` for per-model oriented-box contact and separation beneath spatial broad-phase discovery.
- `player-control-controller.ts` for per-player move intent, hostile wire-value normalization, aim gating, shared driver input, analog/diagonal magnitude, state-gated on-foot movement, collision resolution, reset, and disconnect cleanup.
- `player-appearance-controller.ts` for finite catalog validation, default join fallback, private wardrobe gating, replicated visual-only equipped appearance mutation, update throttling, and disconnect cleanup.
- `player-lifecycle-controller.ts` for death, vehicle/wanted/input cleanup, delegated medical completion, health/ammunition mutation, bounded attack-cancelable spawn protection, and respawn events.
- `pedestrian-controller.ts` for pedestrian spawn/ejected-driver/death/respawn lifecycle and room-facing composition.
- `pedestrian-runtime.ts` for private objectives, threat memory, think/fire/navigation deadlines, and respawn state.
- `pedestrian-perception-system.ts` for police pursuit observations and expiring civilian last-known-threat memory.
- `pedestrian-behavior-system.ts` for explicit ambient/police intent, independent authoritative aim, and fire cadence.
- `pedestrian-melee-system.ts` for fixed-target NPC windup/contact/recovery, impact-time contact revalidation, reaction interruption, cooldown, events, and narrow player-damage requests.
- `pedestrian-reaction-system.ts` for civilian orient/respond/recover transitions and `pedestrian-intent.ts` for the shared output contract consumed by locomotion/presentation projection.
- `pedestrian-navigation-system.ts` for private route ownership, per-tick request budgets, deterministic blocked recovery, and planner composition; `pedestrian-path-planner.ts` for bounded deterministic collision-grid A* with clearance and smoothing; plus `pedestrian-locomotion-system.ts` for continuous per-axis collision movement.
- `world/world-stimulus-registry.ts` for bounded, expiring, deduplicated, same-space sensory facts and `world-stimulus-adapter.ts` for translating stable cross-domain game events with source/subject/actor attribution and perception channels.
- `shared/content/weapon-catalog.ts` for discriminated bullet/thrown/melee definitions, stable IDs, ammunition ownership, combat timing, and renderer-neutral presentation metadata.
- `fire-control-controller.ts` for holder, cooldown, ammunition, seat, protection-cancel, and bullet/thrown/melee dispatch gates; `projectile-controller.ts` remains bullet-only.
- `thrown-projectile-controller.ts` for bounded private grenade velocity, gravity, world/ground bounce, fuse, replicated pose, detonation request, and lifecycle cleanup.
- `explosion-controller.ts` for one-shot radial player/NPC/vehicle resolution, active-source attribution, transient effects, vehicle-destruction adaptation, occupant exclusion, and bounded chain reactions.
- `weapon-pickup-controller.ts` for spatial collection candidates, nearest/ID-stable contention, grenade capacity, shared availability, respawn, notices, and events.

`DistrictRoom` now calls one simulation facade rather than scheduling domain updates. It no longer owns crime registration, witness selection, wanted mutation, police assignment, mission formation, objective transitions, payouts, vehicle access/physics, traffic routes, combat/projectiles/explosions/pickups, player control/lifecycle, pedestrian runtime/behavior, district population assembly, or debug projection. The remaining room code is dependency wiring, Colyseus command/lifecycle adaptation, spatial projection, patch publication, and client transport. New features must enter through an existing controller or add a new domain owner and explicit simulation phase; they must not add another gameplay method to the room.

# NOCK0 Project Organization Blueprint

This document defines how NOCK0 should be organized as it grows from a playable slice into an online 2D GTA-like game with richer pedestrians, traffic, police, missions, economy, interiors, and social systems.

The immediate rule is simple: new gameplay must not be added directly to `DistrictRoom` or `DistrictScene`. Those classes should become coordinators. Behavior belongs to domain systems with explicit inputs, outputs, data, and tests.

## Organization Principles

1. The server owns gameplay truth. The client owns presentation and input collection.
2. A district room coordinates systems; it does not implement every system.
3. Runtime simulation data is separate from synchronized network state.
4. Durable account data is separate from transient district state.
5. Systems query nearby entities through a spatial index, not global collections.
6. Content such as weapons, vehicles, NPC archetypes, and missions is data, not branching code.
7. Cross-system changes use typed commands and events rather than arbitrary imports and mutation.
8. Every sophisticated AI behavior must be runnable in a headless deterministic scenario test.
9. Animation and sound react to gameplay events; they do not decide gameplay outcomes.
10. The repository should grow in stages. Do not create services or packages until a real ownership or deployment boundary exists.

## Recommended Repository Shape

Use this folder-based structure first:

```text
nock0/
  server/
    index.ts
    rooms/
      district-room.ts
    protocol/
      commands.ts
      events.ts
      validation.ts
    simulation/
      simulation.ts
      simulation-clock.ts
      command-queue.ts
      event-queue.ts
      random.ts
      spatial-index.ts
      entity-registry.ts
      lifecycle.ts
    domains/
      players/
      combat/
      pedestrians/
      vehicles/
      traffic/
      police/
      wanted/
      missions/
      pickups/
      world/
    persistence/
      repositories/
      transactions/
      outbox/
    state/
      district-state.ts
      player-state.ts
      vehicle-state.ts
      npc-state.ts
      projectile-state.ts
      state-projector.ts
    observability/
      metrics.ts
      logging.ts
      tracing.ts
  src/
    main.ts
    game/
      district-scene.ts
      network/
      input/
      rendering/
      effects/
      audio/
      camera/
      world/
      ui/
  content/
    weapons/
    vehicles/
    pedestrians/
    police/
    missions/
    districts/
    items/
  tools/
    content-validator/
    map-pipeline/
    replay-runner/
    loadtest/
  test/
    unit/
    scenarios/
    integration/
    load/
    fixtures/
  public/
    assets/original/
  docs/
    adr/
    ENGINEERING_REPORT.md
    PROJECT_STRUCTURE.md
```

This remains one package while the team is small. Move to npm workspaces only when shared code has clear independent ownership or the client and server need separate deployment pipelines:

```text
apps/
  client/
  game-server/
  admin/
packages/
  protocol/
  simulation-core/
  content-schema/
  world-format/
  observability/
tools/
  map-pipeline/
  content-validator/
  loadtest/
```

Do not begin with microservices. District simulation, combat, vehicles, and AI need low-latency in-process calls. Authentication, persistence, matchmaking, telemetry, and asynchronous social features are better candidates for external boundaries later.

## Standard Domain Layout

Each substantial gameplay domain should use the same recognizable shape:

```text
domains/pedestrians/
  pedestrian-system.ts
  pedestrian-runtime.ts
  pedestrian-config.ts
  pedestrian-commands.ts
  pedestrian-events.ts
  perception-system.ts
  behavior-system.ts
  navigation-system.ts
  locomotion-system.ts
  pedestrian-system.test.ts
```

Not every domain needs every file. Add files when they represent real complexity, not to satisfy a template.

### System Contract

A system should receive narrow dependencies:

```ts
interface GameSystem {
  update(context: SimulationContext, deltaSeconds: number): void;
}

interface SimulationContext {
  clock: SimulationClock;
  random: RandomSource;
  entities: EntityRegistry;
  spatial: SpatialIndex;
  world: WorldQueries;
  commands: CommandQueue;
  events: GameEventQueue;
}
```

Systems should not import Colyseus clients or Phaser objects. This keeps gameplay runnable in tests, replays, load generators, and future server workers.

## District Room Responsibility

After extraction, `DistrictRoom` should only:

- authenticate and admit clients;
- create and dispose the district simulation;
- validate message envelopes and enqueue commands;
- invoke fixed simulation steps;
- project authoritative runtime state into Colyseus schema state;
- maintain client area-of-interest views;
- handle reconnection and district transfer lifecycle;
- publish metrics and structured lifecycle logs.

It should not contain weapon math, pedestrian decisions, vehicle steering, mission rules, or police tactics.

### Implemented Boundary

The first room-facing facades are now live:

- `FreemodeMissionController` composes the pure mission state machine, entity scope, state projection, notices, rewards, and cleanup.
- `CrimeResponseController` composes incident registration, witness selection, wanted heat, district dispatch, and pursuit memory.
- `VehicleAccessController` owns entry, hijacking, seats, exits, passenger promotion, and player cleanup.
- `TrafficController` owns deterministic ambient routes and driving targets.
- `DistrictPopulationController` owns idempotent map bootstrap, initial archetype budgets, parked/traffic vehicle creation, and registration through domain APIs.
- `DebugSnapshotController` owns bounded event summaries, sampled simulation diagnostics, domain-to-protocol copies, and developer snapshot publication.
- `VehicleSimulationController` owns handling, impacts, collisions, localized damage, fire, destruction, restoration, and occupant projection.
- `FireControlController`, `ProjectileController`, and `DamageController` separate weapon use, moving projectiles, and victim response.
- `PlayerControlController` owns validated move/aim intent, shared driver input, state-gated on-foot locomotion, collision resolution, and input cleanup.
- `PlayerLifecycleController` owns death and respawn independently of combat and the room.
- `PedestrianController` owns pedestrian spawn/ejected-driver/respawn lifecycle and composes dedicated runtime, perception, behavior, navigation, and locomotion modules.
- `PedestrianReactionSystem` owns staged civilian orient/respond/recover transitions; synchronized NPC action is presentation intent, not a client-side gameplay decision.
- `PedestrianNavigationSystem` owns private goals and route progress behind bounded per-tick search work; the current collision-grid planner is a replaceable adapter for a future authored sidewalk/crossing graph.
- The shared vehicle catalog owns stable model content; vehicle access, player handling, damage/collision, population, traffic, and presentation consume focused portions of the same definition.
- `TrafficAwarenessSystem` computes a bounded desired speed and reason from an ahead corridor; `TrafficController` retains route, acceleration/braking, hijack, blockage, and deterministic recovery ownership.
- `StreetEconomyController` is the in-memory implementation of the cash mutation port. Combat and missions propose stable idempotent rewards; services propose purchases; persistent account/ledger adapters can replace it without entering simulation domains.
- `StreetServiceController` owns replicated service placement, eligibility, quote/debit coordination, notices, and narrow restoration ports; it does not own cash, ammunition, or vehicle damage fields.
- `PlayerInteractionController` owns service-versus-vehicle action priority and same-tick input deduplication, keeping contextual interaction policy out of the room transport adapter.
- `DistrictRoom` invokes these owners from the fixed schedule and maps validated network commands to their public APIs.

ADR 0004 makes this mandatory for future work: adding a gameplay method directly to `DistrictRoom` is not an acceptable implementation shortcut. The room now contains transport lifecycle, dependency wiring, explicit schedule order, and spatial projection. The first client coordinator extraction and the pedestrian perception/behavior/navigation/locomotion split are complete; dynamic population policy and deeper event-driven behavior remain domain work.

## Fixed Simulation Order

The order must be explicit because GTA-like systems interact heavily. A recommended starting order is:

1. Drain and validate player commands.
2. Apply joins, reconnects, transfers, spawns, and despawns.
3. Update vehicle controls and traffic movement.
4. Update pedestrian perception, behavior, navigation, and locomotion.
5. Resolve weapons, projectiles, explosions, impacts, and damage.
6. Resolve crimes, witnesses, wanted heat, police dispatch, and arrests.
7. Advance mission objectives and emit economy rewards.
8. Apply deaths, ejections, pickups, and deferred lifecycle changes.
9. Update spatial-index memberships.
10. Project changed state and area-of-interest membership to clients.

Do not mutate a collection while another system is iterating it. Queue structural changes and apply them in the lifecycle phase.

## Pedestrian AI Organization

Refined pedestrian AI should be layered rather than implemented as one large state machine.

### Archetype and Needs

Data describes who the pedestrian is:

- civilian, gang member, shopkeeper, paramedic, police, mission actor;
- bravery, aggression, awareness, driving ability, weapon skill;
- schedule, destination preferences, faction, legal status;
- reaction thresholds and voice/animation set.

### Perception

`PerceptionSystem` queries the spatial index and world:

- visible players and NPCs;
- nearby gunfire, impacts, crashes, and explosions;
- witnesses and line of sight;
- nearby cover, exits, vehicles, and safe zones;
- recent memory with expiry timestamps.

Perception should update at a lower rate than locomotion. Nearby or mission-critical NPCs can perceive more often than distant ambient NPCs.

### Decision Layer

Start with hierarchical state machines plus scored choices:

- ambient: idle, walk route, cross street, visit destination;
- reaction: investigate, flee, take cover, call police, fight;
- police: patrol, investigate, pursue, contain, arrest, shoot;
- gang: defend territory, assist ally, pursue rival;
- recovery: unstuck, abandon route, respawn.

Avoid a fully generic behavior-tree framework until repeated patterns justify it. A small typed decision API is easier to debug and replay.

### Navigation

Separate navigation from behavior:

- pedestrian navigation graph and sidewalks;
- crossing points and traffic-light metadata;
- path request queue with a per-tick budget;
- path cache keyed by graph version and endpoints;
- local avoidance for nearby pedestrians and vehicles;
- deterministic recovery when blocked.

### Locomotion and Presentation

The server decides position, facing, speed, and action state. The client maps those states to walk, run, aim, fall, enter-car, hijack, and death animations.

Animation completion may send an acknowledged gameplay command only when the server has already authorized the action and owns its timing.

## Driving and Traffic AI Organization

Driving AI needs distinct layers:

```text
traffic/
  traffic-spawn-system.ts
  traffic-route-planner.ts
  lane-graph.ts
  driving-agent.ts
  local-steering.ts
  intersection-controller.ts
  traffic-lod.ts
  traffic-recovery.ts
```

### Lane Graph

The current road-cell graph should evolve into versioned lane metadata:

- lane centerlines and direction;
- speed limits;
- allowed turns;
- intersection entry and exit links;
- stop lines, signals, crossings, and parking points;
- vehicle class restrictions;
- district transfer edges.

The map pipeline should validate disconnected lanes, impossible turns, overlapping spawn points, and missing intersection ownership.

### Route Planning

The route planner selects a destination and a lane-level route. It runs infrequently and under a work budget. Route planning should not happen for every traffic car every simulation tick.

### Local Steering

The driving agent follows the current lane while local steering handles:

- following distance;
- braking for vehicles and pedestrians;
- lane changes;
- obstacle avoidance;
- yielding and intersection reservations;
- crash response;
- recovery when stuck.

The player vehicle and AI vehicles should share core handling and collision primitives. AI supplies steering and throttle inputs through the same control interface used by a player.

### Traffic Level of Detail

Use simulation levels:

- Full: near a player, including collision, impacts, and detailed steering.
- Reduced: farther away, following lane splines with infrequent decisions.
- Virtual: represented as route progress only, with no rendered or networked entity.

Promotion from virtual to full simulation must choose a valid off-camera spawn point and preserve route direction. Demotion must not occur while a player can see or interact with the vehicle.

## Police and Wanted Organization

Police should not be implemented as civilians with one target rule. Separate district-level response from individual officer behavior.

```text
police/
  dispatch-system.ts
  incident-registry.ts
  police-unit-system.ts
  pursuit-coordinator.ts
  roadblock-planner.ts
  arrest-system.ts
```

- Crimes create incidents with location, severity, witnesses, suspect, and expiry.
- Dispatch assigns available units based on distance and escalation.
- Pursuit coordination prevents every officer from choosing the same position.
- Wanted heat controls the response budget, not individual officer omniscience.
- Officers need search behavior after losing sight rather than permanent direct knowledge.
- Arrest, surrender, jail, death, and respawn are separate outcomes.

## Combat Organization

```text
combat/
  combat-system.ts
  weapon-catalog.ts
  fire-control.ts
  projectile-system.ts
  hitscan-system.ts
  explosion-system.ts
  damage-system.ts
  cover-system.ts
  combat-events.ts
```

The weapon catalog is immutable content. Runtime fire control checks ownership, ammunition, cooldown, stance, seat, and action state. Damage resolution owns health changes and emits typed events such as `DamageApplied`, `EntityKilled`, and `CrimeCommitted`.

Wanted, missions, UI, audio, and economy react to those events instead of adding callbacks inside weapon code.

## Mission Organization

Mission code must not directly control every domain. A mission owns objective state and issues normal commands to gameplay systems.

```text
missions/
  mission-system.ts
  mission-definition.ts
  mission-instance.ts
  objective-registry.ts
  objectives/
    reach-zone.ts
    acquire-item.ts
    steal-vehicle.ts
    eliminate-target.ts
    escape-wanted.ts
    deliver-vehicle.ts
```

A mission definition should reference stable content IDs. Objective instances subscribe to typed events and update durable progress. This allows the same combat, traffic, police, and vehicle systems to work inside and outside missions.

## Economy and Persistence Boundaries

The room may propose rewards, purchases, repairs, and inventory changes. A transactional application layer validates and persists them.

Do not let AI or combat systems write directly to PostgreSQL. They emit domain events. A persistence adapter handles idempotency, transactions, and the outbox.

Important boundaries:

- room cash presentation versus durable wallet;
- transient weapon state versus owned inventory;
- spawned vehicle versus owned vehicle record;
- mission runtime versus durable mission progress;
- session ID versus account and character IDs.

## Client Organization

### Implemented Client Boundary

The first client extractions are live under `src/game/input/` and `src/game/rendering/`:

- `client-input-policy.ts` contains framework-independent movement normalization, replicated-state weapon gating, and movement/aim/fire/weapon command cadence.
- `ClientInputController` binds Phaser keyboard/pointer/wheel plus DOM/touch controls, publishes intent commands, reports aim/movement intent for local presentation, and removes every listener on scene shutdown.
- `TouchControls` now owns cleanup for media queries, buttons, and pointer listeners.
- `DebugSnapshotSubscription` owns the explicit developer-snapshot subscribe/unsubscribe lifecycle, including handler-first ordering and teardown.
- `DebugPresentationController` composes that transport with F3/button input, cached panel DOM, sampled collision/spatial/entity/incident/pursuit overlays, label lifecycle, and teardown behind a pure panel projection.
- `CameraPresentationController` owns the active Phaser follow target, player/vehicle smoothing, responsive zoom, damage feedback, and resize/shutdown lifecycle behind a pure camera policy.
- `interpolation-policy.ts` contains framework-independent snap/blend correction and shortest-path angle interpolation.
- `PedestrianRenderer` owns NPC render-object lifecycle, replicated targets, visibility, animation, interpolation, and depth.
- `ProjectileRenderer` owns projectile render-object lifecycle, weapon/police visual policy, interpolation, and muzzle flashes while reporting creation through a narrow callback for player recoil presentation.
- `PlayerRenderer` owns player, weapon, passenger, and nameplate lifecycle; local prediction; remote correction; seat composition; and cosmetic recoil.
- `VehicleRenderer` owns vehicle bodies, police lights, staged damage effects, interpolation, depth, and read-only poses consumed by player composition.
- `LocalHudController` owns cached local HUD DOM, meters, mode visibility, bounded notices, connection state, and teardown behind a pure projection/transition policy.
- `MissionPresentationController` owns mission DOM, action listener/command dispatch, world markers, and teardown behind pure active/joinable, HUD, minimap, target, and delivery projection.
- `DistrictScene` remains the Phaser lifecycle coordinator and uses focused input and rendering owners instead of owning their device bindings, command timers, and entity caches.

The first client modularity pass is complete. The remaining scene is a lifecycle coordinator; future work should extract world loading, vehicle-action affordance, crosshair, or minimap orchestration only when each boundary gains real independent complexity.

`DistrictScene` should become a Phaser lifecycle shell:

```text
game/
  district-scene.ts
  network/
    room-connection.ts
    state-adapter.ts
    event-adapter.ts
  input/
    input-controller.ts
    touch-controller.ts
  rendering/
    player-renderer.ts
    pedestrian-renderer.ts
    vehicle-renderer.ts
    projectile-renderer.ts
    pickup-renderer.ts
    render-pools.ts
  animation/
    animation-controller.ts
    pedestrian-animation.ts
    vehicle-animation.ts
  effects/
    muzzle-effects.ts
    impact-effects.ts
    damage-effects.ts
  world/
    map-renderer.ts
    overlay-renderer.ts
    render-culling.ts
  ui/
    hud-controller.ts
    vehicle-hud.ts
    weapon-hud.ts
    mission-hud.ts
```

Renderers consume presentation models derived from authoritative state. They must not contain gameplay rules. Object pools own bullets, muzzle flashes, impact effects, labels, and short-lived animations.

## Content Organization

Content files should be validated and versioned:

```text
content/
  weapons/pistol.json
  vehicles/sedan.json
  pedestrians/civilian.json
  police/response-levels.json
  missions/first-job.json
  districts/industrial.json
```

Every content family needs:

- a schema;
- stable string IDs;
- a validator;
- referential-integrity checks;
- defaults controlled by the loader, not scattered through gameplay;
- a migration strategy when saved data references old versions.

TypeScript objects are acceptable initially. Move to external data when designers or tools need to edit the content without changing simulation code.

## Testing Layers

### Unit Tests

Test pure calculations, command validation, state transitions, route choices, damage, wanted escalation, and content validation.

### Headless Scenario Tests

Run a district simulation without WebSockets or Phaser:

- pedestrian witnesses a shooting and flees;
- police lose sight and search the correct region;
- traffic stops for a pedestrian;
- two AI cars avoid an intersection collision;
- a passenger fires from each seat;
- a mission advances from vehicle theft to escape;
- the same seed produces the same event sequence.

### Room Integration Tests

Test authentication, joins, messages, schema replication, reconnect, transfers, and hostile input rates.

### Replay Regression Tests

Record validated command streams and random seeds. Re-run them after system changes and compare important state hashes and events. This is especially valuable when pedestrian, traffic, police, and combat systems begin interacting.

### Load and Soak Tests

Simulate realistic mixes of walking, driving, passenger fire, combat, reconnects, AI, and district transfers. Track tick time, bandwidth, event-loop lag, memory, entity count, and client frame time.

## Dependency Rules

Enforce these in review and eventually with lint boundaries:

- `rooms` may import systems, protocol, state projection, and infrastructure.
- systems may import simulation interfaces, world queries, content, and their own domain.
- systems may not import another domain's internal runtime maps.
- domains communicate through public commands, queries, and events.
- synchronized schema classes contain data, not gameplay behavior.
- persistence adapters may import database libraries; simulation systems may not.
- client rendering may import presentation contracts; it may not import server runtime code.
- content may not import runtime state.

## Extraction Order From the Current Prototype

Use behavior-preserving steps:

1. Extract weapon definitions and combat resolution behind `CombatSystem`.
2. Extract collision and add `SpatialIndex` plus `WorldQueries`.
3. Extract player lifecycle and command validation.
4. Extract vehicle seating, driving, impacts, and hijacking into `VehicleSystem`.
5. Extract road graph and ambient driving into `TrafficSystem`.
6. Extract civilian behavior into `PedestrianSystem`.
7. Extract wanted heat and police dispatch separately.
8. Add a fixed `Simulation` coordinator with an explicit update order.
9. Add `StateProjector` so runtime entities are no longer identical to network schema objects.
10. Split client entity rendering and HUD control out of `DistrictScene`.

Each extraction should keep the multiplayer and scenario tests green. Do not combine extraction with a major behavior rewrite.

## Definition of Done for a New Major System

A major gameplay system is not complete until it has:

- a named owner and public API;
- content or configuration separated from runtime state;
- explicit update frequency and entity budget;
- spatial-query behavior where relevant;
- deterministic unit or scenario coverage;
- network-state and transient-event decisions documented;
- metrics for its work and entity counts;
- cleanup and disconnect behavior;
- mobile/client performance consideration;
- no new direct responsibility added to the room or scene coordinator.

This organization lets pedestrian AI, driving AI, police response, missions, and economy become deep systems without coupling every feature to every other implementation detail.

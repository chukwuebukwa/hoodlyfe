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

- `FreemodeMissionController` adapts mission templates to district entities, deterministic route generation, state projection, notices, rewards, and cleanup.
- `MissionSystem` owns Freemode roster/deadline/optional-target/contribution/terminal lifecycle; `MissionObjectiveSystem` evaluates ordered target, participant, hold, and eliminate predicates; `MissionEncounterSystem` owns bounded wave/actor/role/kill-contribution runtime through narrow pedestrian ports. Shared mission content owns definitions and target/reward/encounter policy. Target-free jobs never fabricate a vehicle, while combat contracts expose one stable mission-owned NPC target without taking over pedestrian AI.
- `CrimeResponseController` composes incident registration, witness selection, wanted heat, district dispatch, and pursuit memory.
- `VehicleAccessController` owns entry, hijacking, seats, exits, passenger promotion, and player cleanup.
- `TrafficController` is the room-facing traffic facade. It composes route, awareness,
  junction, authored lane-change, compatibility maneuver, emergency-yield, and low-level
  driving owners without implementing their policy.
- `DistrictPopulationController` owns idempotent persistent map bootstrap and registration
  through domain APIs. In the live room it creates parked/service vehicles only; disposable
  moving pedestrians and traffic belong to streamed population.
- `DebugSnapshotController` owns bounded event summaries, sampled simulation diagnostics, domain-to-protocol copies, and developer snapshot publication.
- `VehicleSimulationController` owns handling, impacts, collisions, localized damage, fire, destruction, restoration, and occupant projection.
- `FireControlController`, `ProjectileController`, `ThrownProjectileController`, `ExplosionController`, and `DamageController` separate weapon use, bullets, bounded thrown/fused motion, one-shot radial resolution/vehicle-chain adaptation, and victim response.
- `MeleeCombatController` owns per-player combo memory, windup/contact/recovery timing, deterministic forward target scoring, line-of-sight, target-family caps, and narrow player/NPC/vehicle damage requests; `melee-hit-policy.ts` keeps contact geometry pure and independently testable.
- `combat-survivability-policy.ts` owns pure armor-before-health resolution plus force/family/direction reaction selection; `CombatReactionController` owns bounded replicated flinch/stagger/knockdown runtime and interruption without taking damage, crime, lifecycle, AI, or rendering ownership.
- The shared weapon catalog is the single ID/family/ammunition/timing/presentation definition consumed by server and both renderers. Adding a weapon no longer requires independent client unions or fallback ammunition behavior.
- `WeaponPickupController` owns collision-safe placement, spatial proximity collection, deterministic contention, quantity caps, shared availability, respawn, notices, and pickup events without importing combat presentation or economy mutation.
- `PlayerControlController` owns validated move/aim intent, shared driver input, action-specific on-foot locomotion, collision resolution, and input cleanup. Melee remains a collision-safe moving action; doorway transitions stay disabled until the strike ends.
- `MedicalCareController` owns registered hospitals, private admission/care choice, nearest-facility selection, living treatment, and idempotent economy coordination.
- `PlayerLifecycleController` owns death/respawn mutation and bounded spawn protection independently of combat and the room; it delegates facility, timing, ammunition, and care policy to medical care.
- `WardrobeInventoryController` owns private namespaced item grants, owner-scoped snapshots, and equip entitlement checks; wardrobe inventory never enters public Colyseus schema state.
- `PlayerAppearanceController` owns join fallback, full-update validation, owned-item gating, public equipped-state mutation, rate limiting, and disconnect cleanup; the shared appearance/wardrobe catalogs own finite content IDs and palette values.
- `PedestrianController` owns pedestrian spawn/ejected-driver/respawn lifecycle and composes dedicated runtime, perception, behavior, navigation, and locomotion modules.
- `PedestrianReactionSystem` owns staged civilian orient/respond/recover transitions; synchronized NPC action is presentation intent, not a client-side gameplay decision.
- `PedestrianCombatSystem` converts a mission-owned target assignment into line-of-sight pursuit/fire intent; pedestrian navigation, locomotion, fire control, projectiles, and damage retain execution ownership.
- `PedestrianMeleeSystem` owns a fixed NPC victim, windup/contact/recovery runtime, one-contact identity, impact-time range/arc/line-of-sight validation, reaction interruption, cooldown, damage requests, and replicated presentation facts. It does not select mission targets, navigate, fire projectiles, mutate survivability directly, or choose renderer animations.
- `PedestrianNavigationSystem` owns private goals and route progress behind bounded per-tick search work; the current collision-grid planner is a replaceable adapter for a future authored sidewalk/crossing graph.
- The shared vehicle catalog owns stable model content; vehicle access, player handling, damage/collision, population, traffic, and presentation consume focused portions of the same definition.
- `LaneGraph` compiles and validates versioned authored centerlines, directed right-hand
  multi-lanes, lane-specific junction connectors, serialized terminal turnarounds,
  lane-derived conflict bounds, speed limits, and vehicle-class admission.
- `TrafficRoutePlanner` owns deterministic visit-bounded lane A*; `TrafficRouteSystem` owns
  durable destination/progress state, recovery reprojection, debug waypoints, authored
  entry/traversal/exit junction movement descriptors, and active versus dormant population
  route adapters. The collision-grid route is a compatibility adapter, not the production
  district representation.
- `traffic-junction-conflict-policy.ts` owns the pure symmetric foe relation for authored
  movement paths. `TrafficJunctionSystem` owns deterministic wait order and a bounded set
  of pairwise-compatible leases through approach, crossing, rear clearance, and expiry.
  Signals, occupancy, predictive awareness, driving, and collision remain separate owners.
- `TrafficAwarenessSystem` computes a bounded desired speed and reason from an ahead
  corridor; `RoadDrivingSystem` owns steering/acceleration/braking; `TrafficController`
  retains only composition, hijack handoff, and blockage timing.
- `traffic-lane-change-policy.ts` owns pure lead/path/front/rear/junction admission.
  `TrafficLaneChangeSystem` owns deterministic target-segment arbitration and private
  request/change-out/pass/return runtime. Neither module owns route selection, collision
  resolution, replication, or presentation.
- `StreetEconomyController` is the in-memory implementation of the cash mutation port. Combat and missions propose stable idempotent rewards; services propose purchases; persistent account/ledger adapters can replace it without entering simulation domains.
- `StreetServiceController` owns replicated nonmedical service placement, eligibility, quote/debit coordination, notices, and narrow restoration ports; it delegates hospital interactions and does not own cash, health, ammunition, or vehicle damage fields.
- `PlayerInteractionController` owns service-versus-vehicle action priority and same-tick input deduplication, keeping contextual interaction policy out of the room transport adapter.
- `DistrictReplicationController` owns per-client Colyseus `StateView` membership and patch-time diffs. Gameplay domains mutate one authoritative district; the replication adapter exposes same-space players/services plus street-only simulation collections without teaching those domains about clients. Newly attached schemas remain in a one-cycle completion set so the installed encoder can force unchanged scalar fields after its initial new-object encode.
- `street-streaming-policy.ts` owns per-client street AOI hysteresis, deterministic priority,
  and patch budgets. `population-activation-policy.ts` owns the player-union hot, prewarm,
  retained, and cold tiers. `population-interest-anchor-policy.ts` converts authoritative
  street-player/vehicle poses into real visibility guards and bounded non-visibility
  lookahead anchors. `population-interest-cluster-policy.ts` compiles disconnected merged
  player-interest components and nearest-component ownership.
  `population-cluster-capacity-policy.ts` owns stable equal entitlements, idle-capacity
  borrowing, pressure, relief math, and fair candidate ordering. `PopulationStreamingController`
  consumes original `district-population-zones.ts` content through the pure
  `population-zone-profile-policy.ts` resolver, time blender, density gate, and composition
  selector. Profiles remain inside cluster/global limits and only converge offscreen.
  `PopulationStreamingController`
  owns lightweight potential records, round-robin
  prewarm-only materialization, bounded offscreen quota rebalancing, dormant progress,
  active ceilings, and gameplay pin rules. Population activation remains separate from
  replication and interaction-island prediction.
- `TrafficJunctionSystem` owns expiring deterministic connector reservations;
  `TrafficManeuverSystem` owns local legitimate-stop filtering plus bounded
  reverse/pass/merge recovery; `TrafficDeadlockSystem` owns persistent blocker-graph cycle
  detection and one safe recovery owner; `TrafficController` composes those policies with
  lane-offset route targets.
- `VehicleCollisionSystem` owns catalog-sized oriented-box narrow-phase contact, minimum-axis separation, impulse, and impact-zone facts. The spatial index provides only broad-phase candidates.
- `DistrictRoom` invokes these owners from the fixed schedule and maps validated network commands to their public APIs.

Client appearance remains split as well: `AppearanceCreatorController` owns modal draft/form/preview/storage presentation, `WardrobeClientSession` owns targeted inventory/store-open subscriptions plus in-flight apply acknowledgement, the canvas policy owns palette/style rendering, `PlayerAppearanceTextureFactory` owns bounded Phaser texture/animation caching, and `PlayerRenderer` only selects the current equipped presentation.

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
  road-route-planner.ts
  road-driving-system.ts
  traffic-controller.ts
  traffic-awareness-system.ts
  traffic-route-planner.ts
  traffic-route-system.ts
  lane-graph.ts
  traffic-lane-change-policy.ts
  traffic-lane-change-system.ts
  driving-agent.ts
  local-steering.ts
  intersection-controller.ts
  traffic-lod.ts
  traffic-recovery.ts
```

### Lane Graph

The Industrial District now has schema-versioned authored lane metadata for:

- lane centerlines, direction, count, index, and spacing;
- speed limits;
- allowed turns;
- intersection entry and exit links;
- lane-derived junction conflict bounds and serialized terminal turnaround policy;
- vehicle class restrictions;

Crossing priority, parking points, permanent route-lane transitions, and district transfer
edges remain future schema extensions.

Runtime loading validates malformed ownership, blocked geometry, sinks, and directed
strong connectivity. A future map-pipeline command should run the same validator before
content reaches a deployment artifact.

### Route Planning

`TrafficRoutePlanner` now provides deterministic bounded A* over directed lane edges and
returns explicit partial work when capped. `TrafficRouteSystem` selects a stable distant
destination and keeps the plan until completion or recovery. `RoadRoutePlanner` remains
for compatibility road cells and other callers. Neither planner runs every simulation
tick.

### Local Steering

The driving agent follows the current lane while local steering handles:

- following distance;
- braking for vehicles and pedestrians;
- reserved authored lane changes with front/rear gap and lead-clearance admission;
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
  crime-response-controller.ts
  police-response-allocation-system.ts
  police-response-fleet-controller.ts
  pursuit-memory.ts
  pursuit-coordinator.ts
  police-force-policy.ts
  police-arrest-controller.ts
  custody-outcome-controller.ts
  police-vehicle-policy.ts
  police-vehicle-controller.ts
```

- Crimes create incidents with location, severity, witnesses, suspect, and expiry.
- Shared response allocation gives simultaneous suspects deterministic shares of one finite foot/cruiser budget, retains leases, replaces materially poor assignments, and suppresses expired unit-report pairs.
- Pursuit memory owns each unit's last-known facts. The pursuit coordinator projects stable
  primary, containment, support, and intercept roles over allocator leases without becoming
  a second allocator, perception system, navigation owner, or outcome authority.
- Fleet control realizes aggregate cruiser demand; foot and vehicle controllers execute
  role-relative goals through separate navigation and movement behavior.
- Wanted heat controls the response budget, not individual officer omniscience.
- Officers need search behavior after losing sight rather than permanent direct knowledge.
- Pure force selection, cancellable arrest contact, one-shot busted lifecycle mutation,
  custody economy/release, medical death/respawn, and future jail transport are separate
  owners.

`PoliceVehicleController` consumes shared assignments and reported suspect snapshots from crime response, composes pure strategy/speed policy, private search memory, and route cadence, then delegates steering to `RoadDrivingSystem`. It does not import wanted internals, ambient traffic policy, collision damage, or player control. Arrest contact and custody are separate modules; planned officer exit, roadblock, stinger, surrender presentation, transport, and jail remain separate future modules rather than additions to this controller.

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

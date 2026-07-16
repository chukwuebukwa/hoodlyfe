# re3 AI and World Simulation Research

Date: 2026-07-10

Target project: NOCK0 browser multiplayer city sandbox

Source reviewed: [`daynz/GTAviceCity`](https://github.com/daynz/GTAviceCity)

Source commit: [`3233ffe`](https://github.com/daynz/GTAviceCity/commit/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)

## Executive Conclusion

This repository is useful as behavioral documentation for a GTA-like world, but it is not a suitable code dependency or engine for NOCK0.

The useful overlap is substantial despite the source game being 3D:

- short-lived world incidents that pedestrians and police can perceive;
- crime reporting, accumulated heat, and wanted-level response budgets;
- pedestrian objectives separated from lower-level movement and action states;
- police dispatch that limits and reassigns active pursuers;
- zone- and time-driven ambient population budgets;
- separate pedestrian and vehicle navigation graphs;
- lane-following traffic with local obstacle avoidance and stuck recovery;
- roadblock locations authored into the world;
- mission-owned entity cleanup and stuck-vehicle monitoring;
- spatial partitioning for perception, collision, and line-of-sight queries.

These patterns transfer well to a top-down game. The 3D renderer, RenderWare integration, vehicle physics, animation implementation, bytecode mission interpreter, raw-pointer object model, and global single-player state do not.

The recommended strategy is clean implementation from documented behavior. Do not copy source code, constants, data layouts, names, or assets from this repository.

## Implementation Status

Phase R0 began on 2026-07-10 with original fixed-step clock, keyed random, spatial-index, deferred-lifecycle, and typed-event implementations under `server/game/`. The integration decision and invariants are recorded in `docs/decisions/0001-deterministic-simulation-foundation.md`.

The next implementation boundary is Phase R1: incidents, witnesses, wanted heat, and district police dispatch.

## Important Repository Finding

The repository name and About text say Vice City, and its README says the Vice City code is on a `miami` branch. However, the fork currently exposes only `master` at commit `3233ffe`; no `miami` branch or tags are available. The checked source is the GTA III `re3` branch, not the Vice City `reVC` branch.

This does not materially reduce its value for our research. GTA III contains the pedestrian, police, wanted, road, traffic, population, world-query, and mission-support systems we need to study.

## Legal and Provenance Boundary

This is a hard engineering constraint, not a documentation detail.

The project README states that the authors do not provide a license and describe the code as reversed from the original binaries. It also says original GTA III assets are required. Public source availability is not permission to incorporate the code into NOCK0.

Rules for NOCK0:

- Do not add this repository as a dependency, submodule, package, or vendored source tree.
- Do not copy or mechanically translate C/C++ functions into TypeScript.
- Do not preserve its exact enums, class layouts, thresholds, crime weights, timings, or spawn formulas.
- Do not use Rockstar maps, scripts, models, audio, names, dialogue, missions, branding, or other content in a public build.
- Treat the repository only as behavioral and architectural research.
- Write an original specification first, then implement against that specification in NOCK0 terminology.
- Use original or explicitly licensed production assets. Local GTA2 extraction remains a private compatibility and prototyping tool only.

Primary reference: [repository README and license statement](https://github.com/daynz/GTAviceCity#license).

## Research Method

The repository was cloned at the pinned commit and mapped across five tracks:

1. provenance, branches, architecture, and licensing;
2. pedestrian, event, wanted, and police behavior;
3. roads, traffic, driving agents, signals, and roadblocks;
4. population, zones, missions, cleanup, and world queries;
5. changes required for deterministic, authoritative multiplayer.

The repository contains roughly 700 files and 237,000 lines of C/C++. The review concentrated on the systems that define observable world behavior rather than rendering or platform integration.

## Reuse Decision Matrix

| Source concept | Value to NOCK0 | Decision |
| --- | --- | --- |
| Timed world-event registry | High | Reimplement as typed incidents with stable IDs and spatial indexing |
| Queued crime reporting | High | Reimplement with witnesses, evidence, suspect identity, and expiry |
| Wanted heat plus response caps | High | Reimplement per player; tune original values from playtests |
| Pursuer list and nearest-unit replacement | High | Reimplement in district dispatch and pursuit coordination |
| Pedestrian objective and action states | High | Reimplement as layered typed state machines |
| Zone/time population density | High | Reimplement as data-driven district population profiles |
| Offscreen spawn/despawn lifecycle | High | Reimplement relative to every relevant player and area of interest |
| Separate road and pedestrian graphs | High | Reimplement in the original map pipeline |
| Lane metadata and traffic signals | High | Reimplement as lane links, stop lines, crossings, and reservations |
| Route following plus local avoidance | High | Reimplement through the same vehicle control interface used by players |
| Far/near pursuit modes | Medium-high | Reimplement as route pursuit and local intercept states with hysteresis |
| Temporary reverse/turn recovery | High | Reimplement as deterministic driving recovery actions |
| Authored roadblock slots | High | Reimplement as map content controlled by dispatch budgets |
| Mission entity cleanup | High | Reimplement as mission-owned entity scopes |
| Stuck-car monitor | Medium-high | Reimplement as a generic objective and vehicle health monitor |
| Sectorized world queries | Critical | Implement a spatial hash before expanding AI counts |
| GTA script bytecode interpreter | Low | Reject; use typed mission definitions and objectives |
| Giant `CPed` object/state machine | Negative | Reject; split data, perception, decisions, navigation, and locomotion |
| RenderWare and 3D physics | None | Reject |
| Global player/singletons/raw pointers | Negative | Reject |
| Frame-number scheduling and global random | Negative | Reject; use room clock, budgets, and seeded random streams |
| Source code and exact constants | Prohibited | Do not copy |

## Transferable System Findings

### 1. Incidents Are the Shared Language of the World

[`EventList.h`](https://github.com/daynz/GTAviceCity/blob/master/src/core/EventList.h) and [`EventList.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/core/EventList.cpp) use a bounded registry of short-lived events such as assaults, gunshots, fires, thefts, hit-and-runs, and explosions. Events carry a type, entity reference, position, offender, and expiry. Duplicate events refresh rather than grow without limit, and AI can query for the nearest relevant event.

This is a strong foundation for emergent behavior because combat, traffic, pedestrians, police, audio, and missions can respond to the same fact without calling each other directly.

NOCK0 adaptation:

```ts
type Incident = {
  id: IncidentId;
  kind: IncidentKind;
  districtId: DistrictId;
  position: Vec2;
  sourceEntityId?: EntityId;
  suspectId?: CharacterId;
  victimId?: EntityId;
  severity: number;
  createdTick: number;
  expiresTick: number;
  evidence: EvidenceRef[];
};
```

Use a bounded `IncidentRegistry` indexed spatially and by suspect. Deduplicate using a semantic key such as source action ID, not exact floating-point positions. Incidents should be authoritative state; presentation events such as sounds and particles remain transient client messages.

### 2. Crime Reporting and Wanted Response Are Separate Steps

[`Wanted.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/core/Wanted.cpp) does not treat every criminal action as an immediate star increase. It queues crimes, suppresses duplicate reports, delays some reports, expires old entries, accumulates different severities, and maps heat ranges to a response budget. That budget controls active officers, law-enforcement vehicles, and roadblock intensity.

This is the most valuable police-system idea in the repository:

```text
criminal action
  -> incident
  -> witness or police perception
  -> report/evidence
  -> suspect heat
  -> response tier
  -> district dispatch budget
  -> unit assignment
```

For multiplayer, wanted state must be keyed by suspect. Police do not know a player's position merely because that player has heat. Units know the last confirmed position, visible vehicle, direction, and age of the sighting. Heat controls the amount and type of response, while perception controls where that response searches.

Recommended NOCK0 model:

- `WantedSystem`: heat, tier, cooldown rules, identity changes, jail and respawn reset policy.
- `IncidentRegistry`: active incidents and evidence.
- `WitnessSystem`: who saw or heard what and whether they can report it.
- `PoliceResponseAllocationSystem`: one finite district response budget with deterministic foot/cruiser leases across simultaneous suspects.
- `PursuitCoordinator`: last-known position, containment targets, and pursuit membership.
- `ArrestSystem`: surrender, restraint, transport, jail, escape, death, and respawn outcomes.

Do not copy the source values. Define NOCK0 crime severities and tier budgets as content data and tune them against multiplayer scenarios.

### 3. Police Use a Response Budget, Not Unlimited Aggro

[`CopPed.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/peds/CopPed.cpp) includes separate crime scanning, pursuit membership, arrest behavior, line-of-sight checks, and combat behavior. A limited number of officers actively pursue; nearer units can replace less useful pursuers.

Transferable rules:

- Dispatch assigns a bounded number of active units per suspect and district.
- Officers outside the active pursuit can patrol, contain, investigate, guard roadblocks, or respond to other incidents.
- Unit selection considers distance, route cost, state, vehicle, and capability.
- Arrest and lethal force are distinct states with distinct conditions.
- Losing sight starts search behavior; it must not preserve exact target coordinates forever.
- Special response types unlock from policy data, not direct checks scattered across officer code.
- Police-free or low-enforcement zones are district policy data.

Multiplayer adds contention: two wanted players can compete for the same units. Dispatch therefore needs district-level capacity and assignment priorities, not only a per-player cap.

### 4. Pedestrians Need Objectives Above Action States

[`Ped.h`](https://github.com/daynz/GTAviceCity/blob/master/src/peds/Ped.h) distinguishes long-lived objectives from lower-level states. Objectives include waiting, fleeing, guarding, following, attacking, entering a vehicle, stealing a vehicle, and similar intentions. Lower states include idle, wandering, seeking, fleeing, aiming, fighting, entering, exiting, driving, passenger, arrest, and death.

The concept transfers; the implementation shape does not. `CPed` is a large, tightly coupled object with many flags and direct world dependencies.

NOCK0 should use layers:

```text
archetype and needs
  -> perception and memory
  -> scored objective selection
  -> typed behavior state
  -> navigation request
  -> locomotion/action command
  -> replicated presentation state
```

Example objective families:

- ambient: wander, commute, wait, shop, talk, cross street;
- reaction: investigate, flee, hide, call police, assist, retaliate;
- gang: patrol territory, confront, assist ally, defend location;
- police: patrol, respond, search, pursue, contain, arrest, use force;
- vehicle: approach door, enter seat, remove occupant, drive, ride, exit;
- recovery: repath, unstick, abandon task, despawn safely.

The server owns objective and action timing. The client selects and blends animations from replicated action state; animation callbacks must not decide whether a hijack, arrest, shot, or vehicle entry succeeded.

### 5. Population Is a Budgeted Lifecycle System

[`Population.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/peds/Population.cpp) combines zone density, time-of-day groups, road density, police demand, visibility, distance, and population caps. It amortizes some work across frame slices and removes distant ambient actors that are no longer useful.

Transferable rules:

- District content defines pedestrian and vehicle density by zone and time profile.
- Spawn budgets reserve capacity for mission actors and emergency response.
- Ambient actors spawn from valid navigation positions outside immediate view.
- Ambient actors can demote or despawn only when no player can observe or interact with them.
- Expensive perception, pathfinding, and lifecycle work is distributed across ticks.
- Mission and pursuit actors are protected from ambient cleanup.

The original code reasons around one player and one camera. NOCK0 must evaluate relevance against all players in the district, then combine that with area-of-interest membership and entity ownership.

### 6. Navigation Separates Cars From Pedestrians

[`PathFind.h`](https://github.com/daynz/GTAviceCity/blob/master/src/control/PathFind.h) and [`PathFind.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/control/PathFind.cpp) maintain distinct vehicle and pedestrian path data. Vehicle links carry lane information; pedestrian paths include crossings. Links can be disabled dynamically.

This is the right model for NOCK0:

- a lane graph for vehicles;
- a sidewalk and crossing graph for pedestrians;
- explicit connectors for parking, doors, garages, and vehicle seats;
- dynamic edge costs or closures for crashes, roadblocks, construction, and missions;
- district transfer edges and interior portals;
- graph validation during map export.

Top-down rendering makes this easier, not different. We can ignore most vertical geometry while retaining a `layerId` for bridges, interiors, roofs, and tunnels.

### 7. Driving AI Is Hierarchical

[`AutoPilot.h`](https://github.com/daynz/GTAviceCity/blob/master/src/control/AutoPilot.h), [`CarAI.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/control/CarAI.cpp), and [`CarCtrl.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/control/CarCtrl.cpp) divide driving into mission intent, route state, lane state, driving style, temporary recovery action, and low-level steering.

The useful design is:

```text
vehicle mission
  -> route planner
  -> lane follower
  -> local steering and avoidance
  -> throttle/brake/steer command
  -> shared vehicle handling and collision
```

Useful behaviors include:

- route-following when far from a target and local intercept behavior when close;
- separate ram, block, cruise, stop, and destination missions;
- hysteresis between far and near modes to prevent rapid state switching;
- temporary reverse or turn actions after detecting that a car is blocked;
- obstacle checks for vehicles, pedestrians, and static objects;
- reduced simulation for distant traffic and full handling near players.

NOCK0 should not reproduce the 3D handling math. AI vehicles should emit the same normalized control command used by players:

```ts
type VehicleControl = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
};
```

That preserves one authoritative handling model and makes AI behavior testable through command traces.

### 8. Signals Belong to Navigation Metadata

[`TrafficLights.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/control/TrafficLights.cpp) associates signals with road links and pedestrian crossings, then decides whether a car should stop based on its current or next link and its position relative to the controlled crossing.

NOCK0 should author:

- stop lines and controlled incoming lanes;
- compatible signal phases;
- pedestrian crossings and walk phases;
- intersection ownership or reservation regions;
- priority rules for emergency vehicles;
- red-light incident hooks.

This is better than having each vehicle infer a traffic light from nearby sprites.

### 9. Roadblocks Are Authored Opportunities

[`RoadBlocks.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/control/RoadBlocks.cpp) uses map-located roadblock opportunities, response intensity, distance checks, and collision validation before spawning police vehicles and officers.

NOCK0 adaptation:

- Map export produces `RoadblockSlot` content with lane coverage, orientation, response types, and safe spawn points.
- `RoadblockPlanner` scores slots ahead of a suspect's last known route.
- Dispatch reserves units and vehicle capacity before activation.
- Activation is hidden from relevant clients until entities can enter their area of interest naturally.
- A roadblock owns its spawned entities and tears them down when the incident ends.
- The planner never blocks every valid escape route unless a mission explicitly requires containment.

### 10. Spatial Partitioning Is Foundational

[`World.h`](https://github.com/daynz/GTAviceCity/blob/master/src/core/World.h) and [`World.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/core/World.cpp) partition the map into sectors used by range, collision, and line-of-sight queries. This confirms that even the original single-player simulation depended on bounded spatial queries rather than repeatedly scanning the entire world.

NOCK0 needs a shared spatial hash before refined AI:

- insert, move, and remove by stable entity ID;
- query circles, AABBs, segments, and neighboring cells;
- filter by entity kind, faction, collision layer, and district layer;
- produce deterministic query ordering where gameplay depends on first match;
- feed perception, bullets, explosions, interactions, traffic avoidance, witnesses, dispatch, and area of interest.

This is prerequisite work, not an optimization to postpone until the game becomes slow.

### 11. Zones Are World-Behavior Content

[`Zones.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/core/Zones.cpp) uses hierarchical zones and associates them with population and density data. NOCK0 should turn that idea into data-driven district profiles:

- commercial, residential, industrial, gang, civic, park, highway, and interior tags;
- pedestrian and traffic density curves;
- allowed ambient archetypes and vehicle classes;
- law-enforcement profile and police access rules;
- crime modifiers and witness likelihood;
- speed limits, parking rules, and driving style distributions;
- ambient audio and presentation references;
- transfer, mission, and safe-zone metadata.

The map should provide geometry and stable content IDs. Runtime systems interpret those tags independently.

### 12. Mission Cleanup Is More Valuable Than the Script VM

[`Script.h`](https://github.com/daynz/GTAviceCity/blob/master/src/control/Script.h) and [`Script.cpp`](https://github.com/daynz/GTAviceCity/blob/master/src/control/Script.cpp) contain a tightly coupled command interpreter that should not be ported. Two support ideas are valuable:

- mission-created entities are registered for cleanup;
- vehicles can be monitored for stuck or invalid conditions.

NOCK0 should implement `MissionEntityScope`:

```ts
interface MissionEntityScope {
  track(entityId: EntityId, cleanup: CleanupPolicy): void;
  release(entityId: EntityId): void;
  dispose(reason: MissionEndReason): DeferredWorldCommand[];
}
```

Typed objectives subscribe to normal domain events. Mission logic should not directly mutate police, combat, traffic, or economy internals.

## What Must Change for Multiplayer

The source is built around one focused player, a shared global world, raw object pointers, global random calls, and logic distributed by rendered frame number. Those assumptions are incompatible with an authoritative browser multiplayer room.

### Identity and State

- Replace `FindPlayer...` and focused-player globals with explicit `CharacterId`, `PlayerSessionId`, and `EntityId` parameters.
- Store wanted state per character and pursuit state per incident or suspect.
- Use stable IDs in incidents, targets, seats, missions, and network state; resolve IDs through stores only when needed.
- Never let a client choose a victim, damage result, witness, arrest result, seat ownership, or wanted change.

### Time and Determinism

- Use the room's fixed simulation tick for expiry, cooldowns, and state transitions.
- Use named seeded random streams for population, routing variation, and behavior choices.
- Do not depend on render frames, wall-clock time, map iteration order, or process-global random calls.
- Queue structural changes and apply them during a fixed lifecycle phase.
- Record accepted commands and random seeds so scenario failures can be replayed.

### Scheduling and Budgets

- Locomotion and collision can update every simulation tick.
- Perception, decision-making, route planning, spawn management, and cleanup run at lower rates.
- Assign deterministic scheduler buckets by entity ID instead of frame-number bit masks.
- Set per-tick budgets for path requests, line-of-sight tests, spawns, despawns, dispatch changes, and incident processing.
- Degrade ambient fidelity before mission, combat, passenger, or pursuit actors.

### Relevance and Networking

- Apply full simulation near interacting players.
- Use reduced lane or path progress farther away.
- Keep virtual population as aggregate route progress when no player can observe it.
- Send clients only entities and incident presentation relevant to their area of interest.
- Replicate action state and authoritative timing; clients interpolate motion and animate presentation.

### Player Density Edge Cases

- A spawn hidden from one player may be visible to another.
- Two players may witness the same incident and report it differently.
- Multiple wanted players may compete for the same police district capacity.
- A civilian or traffic car may be mission-relevant to one player and ambient to another.
- Roadblocks, crashes, and vehicles need shared ownership and cleanup rules when players leave.
- Cross-district pursuit transfer must preserve suspect identity, last-known position, and assigned response without duplicating units.

## Proposed NOCK0 Module Map

```text
server/game/
  world/
    spatial-index.ts
    world-query.ts
    entity-lifecycle.ts
    simulation-clock.ts
    deterministic-rng.ts
  incidents/
    incident-registry.ts
    incident-types.ts
    witness-system.ts
    evidence-system.ts
  wanted/
    wanted-system.ts
    wanted-policy.ts
  police/
    police-response-allocation-system.ts
    police-response-fleet-controller.ts
    pursuit-coordinator.ts
    police-unit-system.ts
    arrest-system.ts
    roadblock-planner.ts
  pedestrians/
    population-system.ts
    perception-system.ts
    objective-system.ts
    behavior-system.ts
    pedestrian-navigation.ts
    pedestrian-locomotion.ts
  traffic/
    lane-graph.ts
    traffic-route-planner.ts
    driving-agent.ts
    local-steering.ts
    intersection-controller.ts
    traffic-recovery.ts
    traffic-lod.ts
  missions/
    mission-system.ts
    mission-entity-scope.ts
    objective-registry.ts
    objectives/
```

This is consistent with the boundaries already proposed in `docs/PROJECT_STRUCTURE.md`. The research validates those boundaries and gives them concrete GTA-like behaviors.

## Recommended Implementation Order

### Phase R0: Simulation Foundation

Implement before deeper AI:

1. shared spatial hash and world-query facade;
2. room clock and deterministic scheduler buckets;
3. seeded random streams;
4. deferred entity lifecycle commands;
5. typed domain-event stream for scenario tests.

Exit condition: combat, interaction, police, and traffic queries no longer require global entity scans, and a recorded scenario replays to the same state hash.

### Phase R1: Incidents, Witnesses, Wanted, and Dispatch

1. typed incident registry with expiry and deduplication;
2. witness perception and reporting;
3. per-character wanted heat and configurable response tiers;
4. district police capacity and unit assignment;
5. last-known-position pursuit and search states;
6. clean reset rules for death, jail, respawn, disconnect, and identity changes.

Exit condition: police respond only to reported or directly observed crimes, lose precise knowledge after line of sight breaks, and stop attacking after the authoritative pursuit reset.

### Phase R2: Pedestrian World

1. zone/time population profiles;
2. sidewalk and crossing graph;
3. perception memory;
4. ambient, reaction, and recovery objectives;
5. spawn, demotion, and despawn lifecycle;
6. police and gang archetypes as specialized policies over shared foundations.

Exit condition: civilians wander, cross roads, react to incidents, flee or report, avoid local obstacles, and recover from blocked routes under a measured AI budget.

### Phase R3: Traffic World

1. versioned lane graph and validation;
2. traffic route planner;
3. driving agent through shared vehicle controls;
4. vehicle and pedestrian local avoidance;
5. signals, stop lines, and intersections;
6. stuck recovery and traffic levels of detail;
7. ambient parking, spawning, and despawning.

Exit condition: traffic circulates without global scans, obeys signals, avoids common obstacles, recovers from blockage, and can be hijacked without special-case traffic code.

### Phase R4: Police Vehicles and Roadblocks

1. route pursuit and local intercept modes;
2. dispatch ownership of police vehicles and occupants;
3. chase tactics and containment assignments;
4. map-authored roadblock slots;
5. pursuit handoff between on-foot and vehicle units;
6. district transfer protocol for active pursuits.

Exit condition: police vehicles can route toward a last-known position, transition to local pursuit, recover from blockage, deploy bounded roadblocks, and stand down cleanly.

### Phase R5: Mission Integration

1. mission entity scopes;
2. typed objectives and event subscriptions;
3. mission reservations for vehicles, locations, and actors;
4. stuck and fail-condition monitors;
5. cleanup, reconnect, and cross-room continuation policies.

Exit condition: missions compose normal world systems and clean up all owned transient state on completion, failure, cancellation, and room shutdown.

## Required Scenario Tests

### Police and Wanted

- An unseen theft creates an incident but no immediate wanted response.
- A civilian witness reports after reaching safety; police dispatch starts from the reported location.
- A nearby officer directly observes a shooting and reports immediately.
- Duplicate damage events do not multiply one crime.
- Two suspects maintain independent heat, evidence, last-known positions, and pursuit units.
- Limited district capacity allocates units predictably between multiple incidents.
- Breaking line of sight transitions officers from pursuit to search.
- Death, jail, respawn, and pursuit reset remove stale officer targets.
- A no-enforcement zone changes dispatch policy without deleting existing incidents.

### Pedestrians

- A civilian hears a gunshot without seeing the shooter and investigates or flees according to archetype.
- A visible armed attack records suspect identity; an occluded one does not.
- Pedestrians choose sidewalks and crossings instead of vehicle lanes.
- Blocked pedestrians repath or recover without teleporting through collision.
- Ambient actors do not spawn or despawn in view of any connected player.
- Mission actors survive ambient population cleanup.

### Traffic

- Traffic follows legal lane direction and allowed turns.
- Cars stop at controlled crossings and proceed after the signal changes.
- Following vehicles keep distance and avoid stopped traffic.
- A blocked car uses bounded recovery, then reroutes or despawns safely.
- A hijacked ambient car leaves traffic control and enters player control exactly once.
- Passengers and seat ownership remain consistent through collisions, disconnects, and exits.
- Far traffic promotion creates a valid car with matching route direction outside every player's view.

### Replays and Scale

- Identical command logs and random seeds produce identical state hashes.
- Entity iteration order does not change dispatch or collision outcomes.
- Population and path budgets remain bounded during a burst of incidents.
- Area-of-interest filtering prevents distant ambient AI from creating client patches.
- A soak test shows no growth in expired incidents, pursuit assignments, mission scopes, or abandoned route requests.

## Metrics Needed While Building These Systems

- active and expired incidents by type;
- witness perception and report counts;
- wanted heat and tier transitions by suspect;
- dispatch queue depth and active units by incident;
- pursuit time in seen, lost, search, contain, arrest, and stand-down states;
- pedestrian counts by simulation level and objective;
- AI think, perception, and path requests per tick;
- lane-graph route latency and cache hit rate;
- traffic blocked duration and recovery outcomes;
- spatial query count, candidate count, and duration by caller;
- state patch bytes by entity type and area of interest;
- deterministic replay state-hash mismatches.

## Permissively Licensed Components to Evaluate

The GTA source cannot be a dependency, but some generic AI building blocks have permissive alternatives.

### Yuka: Timeboxed Evaluation Only

[`Mugen87/yuka`](https://github.com/Mugen87/yuka) is MIT licensed and provides steering behaviors, graph search, state- and goal-driven agents, short-term memory, vision, and triggers. Its engine-independent design means its math can operate without its Three.js examples. It is the closest legal off-the-shelf match for local pedestrian steering and perception experiments.

Do not adopt it as the world model or authoritative scheduler. Its published npm package is old, and the repository's latest commit is from 2023. A timeboxed spike should answer:

- Can its steering calculations run deterministically under our fixed room tick?
- Can we use plain data adapters without making Yuka entities authoritative state?
- Does it allocate or scan too much for the target pedestrian count?
- Can its 3D vectors be constrained cleanly to NOCK0's 2D plane and layer IDs?
- Can we serialize only our state and reconstruct any Yuka runtime helpers?

Adopt only isolated algorithms or adapters if the spike beats a small purpose-built implementation in correctness, performance, and maintainability.

### EasyStar.js: Prototype Grid Paths Only

[`prettymuchbryce/easystarjs`](https://github.com/prettymuchbryce/easystarjs) is MIT licensed and supplies asynchronous grid A*. It could support an early sidewalk-grid prototype, but it is not a lane graph, does not model intersections or traffic rules, and has not had a repository commit since 2020. It should not become the traffic-navigation foundation.

### Recommendation

- Keep Phaser for browser rendering and Colyseus for bounded authoritative rooms.
- Build the spatial index, incident model, dispatch, content zones, lane metadata, and deterministic scheduler as NOCK0 domain code.
- Run a benchmark spike before using Yuka for local steering or perception helpers.
- Use a small, replaceable A* implementation behind `PedestrianRoutePlanner` and `TrafficRoutePlanner`; never expose a library's node types across domain boundaries.
- Record license, pinned version, benchmark, determinism result, and removal plan in an architecture decision before adding any AI dependency.

## Final Recommendation

Use this repository as a behavioral reference for the GTA-like simulation, especially incidents, response budgets, pedestrian objectives, population lifecycle, route/local-driving separation, and spatial queries. Do not attempt to run it in the browser, port its classes, or translate its code.

The immediate development move is Phase R0 followed by Phase R1. A spatial index and deterministic simulation foundation make the police, pedestrian, and traffic ideas safe to add. Implementing refined AI first inside the current room monolith would produce the same coupling problems visible in the original source, while also making multiplayer correctness and load testing much harder.

## Primary Source Index

- [Repository and README](https://github.com/daynz/GTAviceCity)
- [Timed world events](https://github.com/daynz/GTAviceCity/blob/master/src/core/EventList.cpp)
- [Crime queue and wanted response](https://github.com/daynz/GTAviceCity/blob/master/src/core/Wanted.cpp)
- [Pedestrian objectives and states](https://github.com/daynz/GTAviceCity/blob/master/src/peds/Ped.h)
- [Police pedestrian behavior](https://github.com/daynz/GTAviceCity/blob/master/src/peds/CopPed.cpp)
- [Population lifecycle](https://github.com/daynz/GTAviceCity/blob/master/src/peds/Population.cpp)
- [Pedestrian and vehicle path graphs](https://github.com/daynz/GTAviceCity/blob/master/src/control/PathFind.cpp)
- [Per-vehicle autopilot state](https://github.com/daynz/GTAviceCity/blob/master/src/control/AutoPilot.h)
- [Vehicle mission AI](https://github.com/daynz/GTAviceCity/blob/master/src/control/CarAI.cpp)
- [Traffic steering and routing](https://github.com/daynz/GTAviceCity/blob/master/src/control/CarCtrl.cpp)
- [Traffic signal integration](https://github.com/daynz/GTAviceCity/blob/master/src/control/TrafficLights.cpp)
- [Roadblock activation](https://github.com/daynz/GTAviceCity/blob/master/src/control/RoadBlocks.cpp)
- [Spatial world queries](https://github.com/daynz/GTAviceCity/blob/master/src/core/World.cpp)
- [Zone data](https://github.com/daynz/GTAviceCity/blob/master/src/core/Zones.cpp)
- [Mission cleanup and stuck-car checks](https://github.com/daynz/GTAviceCity/blob/master/src/control/Script.cpp)

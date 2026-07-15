# Systemic Gameplay Implementation Plan

Date: 2026-07-14

Status: Active

## Objective

Build an educational, original GTA-like systemic world on top of NOCK0's existing
server-authoritative interaction-island netcode. Mature reversed sources are read-only
behavioral references. Their code, assets, identifiers, and data tables are not copied.

This plan implements
[`decisions/0003-reference-first-gameplay-development.md`](decisions/0003-reference-first-gameplay-development.md)
and composes with
[`WORLD_INTERACTION_NETCODE_ARCHITECTURE.md`](WORLD_INTERACTION_NETCODE_ARCHITECTURE.md).
It does not create a second development process.

## Pinned Reference Set

| Reference | Snapshot | Use |
|---|---|---|
| [mrxenginner/reVC](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a) | `b9eeb33efcd04a5b7a423921609baef11bf4719a` | Expanded Vice City behavior and system interactions |
| [hottabxp/re3](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503) | `3233ffe1c4b99e8efb4c41c6794b4fce880cf503` | Simpler GTA III baseline and comparison point |
| NOCK0 netcode architecture | current branch | Authority, prediction, rewind, AOI, LOD, and side-effect policy |

`reVC` was derived from `re3`; it is an expanded sibling, not an independent engine
design. Compare both when the delta reveals production nuance. Prefer permissively
licensed sources for implementation techniques. Treat both reversed repositories as
read-only educational references because neither grants a software license.

## Domain Source Index

| Domain | Primary reference paths | Existing NOCK0 owners |
|---|---|---|
| Simulation phases | `src/core/Game.cpp`, `src/core/World.cpp` | `server/district-room.ts`, shared simulation kernels |
| Events and stimuli | `src/control/EventList.*` | pedestrian stimuli, crime response, audio events |
| Wanted and crimes | `src/core/Wanted.*` | `server/game/wanted/`, `server/game/police/crime-response-controller.ts` |
| Police tactics | `src/peds/CopPed.*`, `src/control/RoadBlocks.*`, `src/objects/Stinger.*` | `server/game/police/` |
| Traffic | `src/control/AutoPilot.*`, `src/control/CarAI.*`, `src/control/CarCtrl.*` | `server/game/traffic/` |
| Pedestrians | `src/peds/Ped.*`, `src/peds/PedAI.cpp`, `src/peds/PedAttractor.*` | `server/game/pedestrians/` |
| Weapons | `src/weapons/Weapon.*`, `WeaponInfo.*`, `WeaponType.h` | `shared/content/weapon-catalog.ts`, `server/game/combat/` |
| Vehicle handling and damage | `src/vehicles/HandlingMgr.*`, `Transmission.*`, `DamageManager.*`, `Automobile.cpp` | `server/game/vehicles/`, shared vehicle kernels |
| Encounters and missions | `src/control/SetPieces.*`, `Script.*` | mission, encounter, and entity-scope controllers |
| Zones and population | `src/core/Zones.*`, `Population.*`, `Streaming.*` | population streaming, replication AOI, zone content |

Each milestone research note must link exact GitHub permalinks at the pinned commit,
not a moving branch URL.

## Non-Negotiable Architecture

### Authority boundary

- The district server owns AI decisions, crimes, wanted state, damage, arrests,
  inventory, missions, spawning, payouts, and durable transactions.
- The client predicts locally controlled movement and bounded imminent physical contact.
- Prediction-island promotion never transfers ownership or runs remote AI.
- Historical rewind answers bounded hitbox or obstruction queries. It never reruns AI,
  wanted logic, explosions, missions, economy, or vehicle pileups.

### Netcode change control

The interaction-island implementation is a frozen dependency for systemic-gameplay
milestones. "On top of" does not mean that gameplay systems may absorb, replace, or
silently retune multiplayer behavior.

- Gameplay milestones may consume authoritative actor state and emit ordinary replicated
  state or one-shot event results.
- They may not change prediction, reconciliation, remote interpolation, AOI admission,
  interaction-island selection/replay, combat rewind, rollout policy, or shared
  movement/contact kernels merely to make a gameplay feature easier to implement.
- AI decisions, stimuli, wanted state, dispatch, mission logic, damage, economy, and
  persistence never execute during client replay.
- Additive opt-in debug fields are allowed when they do not affect authority, admission,
  simulation, or presentation outside the debug subscriber path.
- If production evidence shows that a gameplay milestone genuinely requires a netcode
  change, stop that milestone and create a separate multiplayer adaptation contract,
  impairment acceptance criteria, rollout flag, and checkpoint. Do not hide it inside the
  gameplay commit.

### Four independent scopes

1. Server simulation activation decides which potential actors become active.
2. Replication AOI decides which active state each client receives.
3. Prediction islands decide which nearby bodies a client temporarily resimulates.
4. Presentation LOD decides which assets, animations, audio, and effects are rendered.

No gameplay system may collapse these scopes into one distance check.

### Replay side effects

| Class | Replay policy |
|---|---|
| Pure state: pose, velocity, action phase | Replay freely |
| Continuous presentation: engine loop, run animation | Derive from final state |
| One-shot presentation: sound, particles, shake | Suppress during replay and deduplicate by event ID |
| Gameplay outcome: damage, crime, arrest, pickup | Server only, execute once |
| Durable transaction: payout, purchase, ownership | Outside fixed-tick replay |

## Ordered Milestones

### G0 - Simulation phase and event contracts

Status: Complete on 2026-07-14. See
[`SIMULATION_PHASE_STIMULUS_RESEARCH.md`](SIMULATION_PHASE_STIMULUS_RESEARCH.md),
[`decisions/0006-district-simulation-phase-pipeline.md`](decisions/0006-district-simulation-phase-pipeline.md),
and the timestamped devlog checkpoint.

Extract a named `DistrictSimulation` phase pipeline from the room adapter. Define a typed
`WorldStimulus`/incident contract with stable IDs, source, actor, victim, position,
intensity, lifetime, attribution, and visibility. Preserve current behavior while moving
ownership.

Why first: police, pedestrians, weapons, traffic, missions, audio, and population all
depend on deterministic phase order and one shared vocabulary for world events.

Netcode gate: shared movement/contact kernels remain pure; side effects occur after
authoritative collision resolution and are excluded from replay.

G0 compatibility boundary: existing history capture and interaction-snapshot capture keep
their prior relative positions in the server tick. No prediction, replay, interpolation,
AOI, reconciliation, rewind, rollout, or shared simulation algorithm changes are in scope.

G0 architecture checklist:

- [x] The room delegates one fixed-step callback to a named 16-phase coordinator.
- [x] Phase order, history capture, event dispatch, snapshot capture, and patch publication
  retain their previous relative order.
- [x] One bounded, space-aware `WorldStimulusRegistry` replaces pedestrian-private sensory
  storage without becoming replicated gameplay state.
- [x] Transient game events, sensory stimuli, and durable incidents have separate owners and
  lifetimes.
- [x] Source, subject, responsible actor, provenance, perception channels, and spatial scope
  survive event-to-stimulus adaptation.
- [x] F3 exposes phase count, aggregate and slowest cost, and failures for opt-in subscribers.
- [x] Prediction, reconciliation, interpolation, AOI, island selection/replay, rewind,
  rollout, and shared movement/contact kernels are unchanged.
- [x] Deterministic, full-suite, permanent netcode, strict impairment-soak, production-build,
  real two-client, and live Three-client gates pass.

### G1 - Crime, wanted, and response-budget vertical slice

Implement the full path:

```text
stimulus -> crime candidate -> witness/report -> suspect record
  -> wanted state -> response budget -> assigned pursuers -> search/clear
```

Wanted level controls limits and tactics; it does not directly create arbitrary cops.
Add per-suspect active pursuer and police-vehicle limits, search state, identification,
cooldown rules, assignment scoring, and replacement of unsuitable or distant units.

Acceptance: two simultaneous wanted players share a bounded district police pool without
duplicate assignments, unstable oscillation, or client authority.

### G2 - Road graph and production traffic behavior

Introduce an authored directed lane graph and separate:

- long-term route or mission;
- driving style;
- temporary maneuver;
- low-level steering/throttle/brake command.

Add time-to-collision and swept oriented-box awareness, lane arbitration, passing,
yielding, reverse recovery, maneuver cooldowns, and deterministic deadlock resolution.

Netcode gate: traffic AI remains server-only. A promoted traffic car exposes physical
state plus its last applied command for short island replay; the client never runs route
selection or driving AI.

### G3 - Police tactics and escalation

Build police behavior on G1 budgets and G2 driving:

- observe, intercept, pursue, contain, arrest, and disengage phases;
- on-foot and vehicle unit suitability;
- roadblock opportunities, stingers, reinforcement staging, and unit replacement;
- multi-suspect allocation and mission/persistence pins.

Roadblocks and stingers are authored opportunities instantiated through ordinary actors,
collision, damage, and mission-scope systems.

### G4 - Ped objective stack, personality, and attractors

Separate persistent goal, interruptible objective stack, movement state, reaction state,
wait state, timers, and memory. Add data-defined fear, aggression, lawfulness, loyalty,
threat persistence, groups, and attractor queues for services and interiors.

Netcode gate: ped AI is server-only. Remote peds interpolate; only bounded contact proxies
can enter a local prediction island.

### G5 - Weapon runtime and combat reactions

Extend weapon definitions with runtime magazine, reserve ammunition, reload, recoil,
spread recovery, movement accuracy, falloff, penetration policy, animation timing, armor,
proof flags, and directional reactions.

Preserve current command validation, timestamp mapping, historical hit queries,
correlated projectile shadows, and authoritative damage. Do not port single-player
firing code over the multiplayer command path.

### G6 - Vehicle handling, component damage, and occupants

Deepen handling profiles, tires, steering pull, lights, armor, engine stages, component
state, repair value, occupant reactions, abandonment, fire, and delayed explosion.

Netcode gate: handling and collision kernels may be shared for replay. Damage, crimes,
occupant injury, fire, and explosion remain authoritative one-shot outcomes.

### G7 - Encounter opportunities and reusable missions

Add an `EncounterDirector` for authored opportunity volumes that reserve population and
response budgets, spawn ordinary systemic actors, own entity scope, and clean up safely.
Compose these with reusable mission objectives rather than embedding bespoke logic in the
district room.

### G8 - Zone-driven population and virtualization

Drive archetypes, density, traffic classes, police presence, services, schedules, and
ambience from zone/time profiles. Maintain one population around merged player, mission,
pursuit, property, and high-speed lookahead anchors. Persist compact virtual state outside
active cells and pin owned, mission, damaged, or engaged actors.

### G9 - Durable social and economic systems

Only after the street simulation is stable: durable character identity, inventories,
garages, properties, crews, markets, businesses, and repeatable group missions. Any
external settlement remains asynchronous and outside the district tick.

## Milestone Goal Loop

Every milestone follows this state machine. A milestone cannot skip directly from
research to commit.

### 1. Select

- Choose the earliest unblocked milestone.
- State the user-visible failure or capability it addresses.
- Identify its domain owner and affected netcode paths.

### 2. Inspect references

- Read both pinned source implementations where available.
- Record invariants, timers, state transitions, tuning relationships, and edge cases.
- Identify what changed between `re3` and `reVC` and why that difference matters.
- Consult a permissively licensed or official multiplayer reference when networking,
  concurrency, or persistence changes are involved.

### 3. Write the adaptation contract

Before implementation, document:

- transferable behavior;
- rejected engine-specific or single-player assumptions;
- server authority and durable ownership;
- command, state, event, and lifecycle contracts;
- simulation phase;
- AOI, LOD, prediction, rewind, and interpolation policy;
- replay side-effect classification;
- overload, stale-state, and missing-history behavior;
- debug observability and acceptance tests.

### 4. Implement vertically

- Keep the room as a network adapter and composition root.
- Put policy in a focused domain controller.
- Put deterministic movement/contact in shared pure kernels only when client prediction
  needs it.
- Integrate one complete playable path before broadening content.

### 5. Verify

Required gates scale with risk:

- deterministic unit and scenario tests;
- typecheck and production build;
- real two-client flow for shared interactions;
- impairment or interaction-island tests for prediction changes;
- browser QA and canvas checks for presentation changes;
- debug metrics proving state transitions, budgets, selection reasons, and failures;
- `git diff --check` and an ownership review for room growth.

### 6. Checkpoint

- Update the research/adaptation note.
- Add a timestamped devlog entry with QA evidence and known limitations.
- Commit one coherent milestone and push the current branch.
- Do not mark the milestone complete while required tests or runtime sessions are pending.

### 7. Reassess

- Re-read this dependency order and current telemetry.
- Fix regressions or architecture debt before adding breadth.
- Select the next earliest unblocked milestone with the highest player-visible value.

## Completion Definition

The program is complete only when the systemic domains operate through explicit modular
contracts, remain server-authoritative under multiple clients and impaired networks,
stream within measured budgets, expose their decisions in debug tooling, and support
original content without relying on reversed code or proprietary assets.

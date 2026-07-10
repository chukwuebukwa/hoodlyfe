# Pedestrian System Research and Modular Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

The GTA III/Vice City code does not place pedestrian population or behavior in the world/session coordinator.

- `CPopulation` owns ambient actor counts, density, spawn/removal policy, zone and model selection, and the distinction between random, mission, police, gang, and emergency actors.
- `CCivilianPed` owns civilian reactions and objectives such as wandering, threat response, fleeing, fighting, and reporting danger.
- `CCopPed` owns one officer's tactics and arrest/pursuit behavior; `CWanted` owns the wider response level and available police response.
- `CPed` owns shared state, objectives, locomotion, threat memory, timers, and transitions, while route and placement helpers remain separate concerns.
- Pedestrian control is gated by explicit states such as dead, dying, entering a vehicle, and driving. Current and previous state are retained so interruptions can recover coherently.
- Population placement validates usable positions. Spawn pressure and actor selection are influenced by zones, density, player context, and vehicle speed rather than using one global random scatter.
- Perception and decision work runs through timers and memory, while locomotion continues every frame. This avoids evaluating expensive behavior at render frequency.

References:

- [`Population.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.h)
- [`Population.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.cpp)
- [`CivilianPed.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CivilianPed.h)
- [`CivilianPed.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CivilianPed.cpp)
- [`CopPed.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.h)
- [`CopPed.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp)
- [`PedAI.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedAI.cpp)
- [`PedRoutes.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedRoutes.h)
- [`PedPlacement.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedPlacement.h)

The reference is used only to study behavior and ownership. NOCK0 code remains an original TypeScript implementation under this repository's license.

## NOCK0 Adaptation

The first extraction establishes one room-facing owner without prematurely creating a generic AI framework:

1. `PedestrianController` owns synchronized NPC creation plus private runtime memory for wandering, thinking, firing, panic, threats, and respawn deadlines.
2. It consumes a narrow police-target query supplied by `CrimeResponseController`; it does not assign officers or mutate wanted state.
3. It requests police fire through `FireControlController`; it does not create projectiles or apply damage itself.
4. It owns collision-safe pedestrian locomotion and deterministic low-frequency wander decisions.
5. It owns ejected-driver creation because that actor becomes an ambient civilian after vehicle access creates the event.
6. `DistrictRoom` only schedules pedestrian updates and updates spatial-index projection.

The next behavior-depth phase should split the controller internally as complexity becomes real:

- `population-policy.ts`: density budgets, archetypes, zones, activation, spawn/despawn, and mission ownership;
- `perception-system.ts`: vision, hearing, incidents, nearby traffic, and expiring memory;
- `behavior-system.ts`: explicit ambient, reaction, police, gang, and recovery states/objectives;
- `navigation-system.ts`: sidewalk graph, crossings, destinations, path requests, and stuck recovery;
- `locomotion-system.ts`: local steering, separation, vehicle avoidance, and collision resolution;
- pedestrian content data: health, bravery, awareness, aggression, speed, weapon skill, model, animation, and voice set.

These layers stay inside the pedestrian domain. They communicate with combat, vehicles, incidents, wanted, missions, and animation through typed queries, commands, and events rather than direct cross-domain mutation.

## Required Production Nuance

- Ambient population has district and archetype budgets; police and mission actors cannot be accidentally removed as ordinary civilians.
- Perception, decisions, pathfinding, and locomotion use different update rates.
- Behavior is explicit and inspectable, including current objective, previous state, target, timers, and last-known threat information.
- Civilian response depends on bravery, distance, available escape routes, witnessed incidents, and nearby allies rather than always fleeing identically.
- Police consume district dispatch assignments but own individual pursuit, search, containment, arrest, cover, and fire decisions.
- Placement validates footprint, world bounds, navigation reachability, visibility policy, and distance from active players.
- Death, vehicle entry/ejection, mission ownership, and district transfer are lifecycle states, not incidental flags.
- Server decisions remain deterministic and authoritative. The client animates replicated intent and events but never decides pedestrian outcomes.

## Acceptance Tests for This Extraction

- District population creates ten civilians and three police at valid open positions with the established health values.
- Equal seeds produce equal initial headings and wander decisions.
- A panicked civilian turns and moves away from its current player threat.
- Police consume an assigned pursuit target, move toward its last-known location, and request rate-limited fire only with line of sight and range.
- Dead pedestrians remain inactive until their deadline, then respawn alive at a collision-safe location with archetype health restored.
- Carjacking creates an indexed ejected civilian beside the vehicle with the hijacker recorded as a temporary threat.
- Existing witnessed-crime, police dispatch, combat, vehicle, and two-client scenarios remain green.

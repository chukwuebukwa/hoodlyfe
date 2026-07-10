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

The pedestrian domain now exposes one room-facing lifecycle facade over focused simulation layers:

1. `PedestrianController` owns synchronized NPC creation, ejected-driver creation, death/respawn lifecycle, and layer scheduling. It does not decide movement or tactics.
2. `pedestrian-runtime.ts` owns private, server-only objectives, think/fire deadlines, panic memory, last-known threat position, navigation recovery, and respawn deadline.
3. `PedestrianPerceptionSystem` consumes the narrow police pursuit query and resolves expiring civilian threat memory. A temporarily missing player does not erase the civilian's last-known danger location.
4. `PedestrianBehaviorSystem` converts observations into explicit `wander`, `flee`, `pursue`, or `search` intent. Police authoritative target aim remains separate from collision detours.
5. `PedestrianNavigationSystem` owns deterministic blocked-path recovery and its independent decision cadence.
6. `PedestrianLocomotionSystem` owns continuous collision-safe, per-axis movement.
7. Police fire remains a request to `FireControlController`; pedestrian AI never creates projectiles or applies damage itself.
8. `DistrictRoom` only schedules the facade and projects resulting positions into the spatial index.

The next behavior-depth phase should add real production complexity behind these established boundaries:

- `population-policy.ts`: density budgets, archetypes, zones, activation, spawn/despawn, and mission ownership;
- perception stimuli: bounded gunshot, impact, injury, death, and explosion events with severity, radius, source, and expiry;
- richer behavior: bravery-scaled flee/investigate/fight choices, police containment/arrest, and recovery transitions;
- navigation: sidewalk graph, crossings, destinations, path-request budgets, and longer-term stuck recovery;
- locomotion: local separation, moving-vehicle avoidance, and crowd steering;
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
- Police collision detours do not change their authoritative aim angle or fire cadence.
- Civilian threat memory retains a last-known player location only until the panic window expires.
- Navigation recovery is deterministic and locomotion resolves blocked axes independently.
- Dead pedestrians remain inactive until their deadline, then respawn alive at a collision-safe location with archetype health restored.
- Carjacking creates an indexed ejected civilian beside the vehicle with the hijacker recorded as a temporary threat.
- Existing witnessed-crime, police dispatch, combat, vehicle, and two-client scenarios remain green.

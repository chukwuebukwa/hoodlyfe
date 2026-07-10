# District Population Research and Bootstrap Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

Production population is assembled by dedicated managers over world content rather than by a session coordinator.

- `CPopulation` owns pedestrian creation/removal, global and archetype counts, density pressure, distance/visibility rules, zone occupation selection, police/gang/emergency distinctions, in-car pedestrians, and lifecycle management.
- `CCarCtrl` owns ambient vehicle generation budgets, zone-weighted model classes, road-density multipliers, path/lane spawn validation, autopilot setup, traffic updates, and removal.
- `CTheZones` supplies time-sensitive pedestrian groups, car classes, gangs, police, and density data for the current world area.
- `CPathFind` supplies usable road nodes, links, lanes, creation coordinates, closeness checks, and route connectivity. Traffic does not spawn from arbitrary collision-free ground.
- Mission, parked, random, police, gang, and emergency entities are classified differently so density cleanup cannot remove protected actors accidentally.
- Creation and removal are incremental and budgeted. Player position, camera/visibility, speed, road density, zone, streaming availability, and world limits affect when an actor exists.

References:

- [`Population.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.h)
- [`Population.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.cpp)
- [`CarCtrl.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.h)
- [`CarCtrl.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp)
- [`Zones.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Zones.h)
- [`Zones.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Zones.cpp)
- [`PathFind.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/PathFind.h)
- [`PathFind.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/PathFind.cpp)

The reference is used only to study behavior and ownership. NOCK0 remains an original TypeScript implementation.

## NOCK0 First Extraction

`DistrictPopulationController` becomes the room-facing owner of initial map population:

1. Initialize the district mission-contact position from map content.
2. Spawn the current ten civilians and three police through `PedestrianController`.
3. Spawn three parked/starter vehicles with authoritative vehicle config and validated footprints.
4. Spawn eight ambient cars only on road cells and register their cruise routes through `TrafficController`.
5. Notify spatial projection when a vehicle is created.
6. Be idempotent so room recreation/setup code cannot duplicate actors or traffic runtimes.

The controller composes existing public APIs. It does not own pedestrian behavior, traffic routing, vehicle physics/damage, mission reservation, or network replication.

## Required Production Nuance

The next population phase should replace fixed counts with data and policy modules:

- district content defines zones, time/weather schedules, archetype/model weights, parked-car anchors, emergency spawns, safe zones, and hard caps;
- population budgets distinguish ambient, mission, police, gang, service, property, and player-owned entities;
- activation uses player interest areas and hysteresis so actors do not pop in/out at one threshold;
- spawn validation checks footprint, navigation connectivity, road lane/direction, line of sight, minimum/maximum player distance, interiors, and reservation ownership;
- despawn excludes visible, occupied, damaged, wanted-response, mission, persistent, and recently interacted entities;
- multiple players contribute to a merged district budget without multiplying population per client;
- model/asset availability and content validation happen before creation;
- structural creation/removal is deferred to the lifecycle phase and emits typed events for replay/debugging;
- deterministic stream keys include district, zone, archetype, population slot, and activation epoch;
- persistence stores only durable ownership/customization state, not every ambient actor.

## Acceptance Tests for This Extraction

- One bootstrap creates exactly 13 pedestrians and 11 vehicles with the established archetype split.
- Every actor has a valid collision footprint; all eight ambient cars begin on road cells.
- Parked and traffic vehicles receive the authoritative max health for their model.
- Traffic IDs, models, starts, headings, speeds, and cruise registrations remain deterministic.
- Mission contact matches map spawn content.
- Calling bootstrap twice creates no duplicate state or route registration.
- Existing multiplayer startup still reports 13 NPCs, 11 vehicles, and moving ambient traffic.

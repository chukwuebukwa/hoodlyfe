# ADR 0004: District Room Is a Network Adapter

Date: 2026-07-10

Status: Accepted

## Context

`DistrictRoom` reached more than 1,700 lines while owning Colyseus lifecycle, simulation order, traffic, vehicle handling, seating, combat, projectiles, pedestrian behavior, crime response, and missions. Continuing that pattern would make every feature depend on one mutable class and prevent parallel development.

The GTA III/Vice City source keeps separate owners for wanted state and crime queues (`CWanted`), event-to-crime translation (`CEventList`), population (`CPopulation`), individual police behavior (`CCopPed`), vehicles, pedestrians, and running mission scripts. Its exact C++ architecture and globals are not a browser-server template, but the ownership boundaries are production evidence that these systems must not collapse into the session coordinator.

## Decision

`DistrictRoom` is a transport and schedule adapter. New gameplay behavior cannot be implemented as a private room method.

- Pure policies and state machines remain framework-independent under `server/game/<domain>/`.
- A domain may expose one room-facing controller that composes its internal policies and accepts narrow callback ports.
- Controllers may project authoritative results into Colyseus schema state, but pure policies may not import Colyseus.
- The room creates controllers, maps validated network messages to controller commands, and invokes controllers in fixed simulation order.
- Cross-domain facts use `GameEventStream`; controllers do not call each other's internals.
- Runtime-only maps remain with their owning controller and are not exposed to unrelated domains.
- Client notices, entity release, spatial queries, and other infrastructure enter through explicit callbacks until shared ports justify dedicated interfaces.

## Current Application

- `FreemodeMissionController` owns formation, target reservation, updates, payouts, schema projection, and cleanup while `MissionSystem` stays pure.
- `CrimeResponseController` owns incident, witness, wanted, dispatch, and pursuit composition while each policy remains independently tested.
- `DistrictRoom` retains only the callbacks those controllers need: player notices, nearby-NPC queries, witness panic projection, and delivered-vehicle release.

## Enforcement

Each extraction must preserve the production build, domain tests, room integration test, and browser scenario. A future boundary lint rule should reject domain imports of `district-room.ts`, Phaser, persistence, or chain libraries.

The next room-owned blocks are extracted in this order:

1. vehicle lifecycle, seating, hijacking, and authoritative driving adapter;
2. traffic routing and driving-agent controller;
3. combat, projectile, and damage controller;
4. pedestrian population, behavior, navigation, and locomotion;
5. player lifecycle and command validation;
6. state projection, debug projection, and area-of-interest views.

## Consequences

- The codebase remains a modular monolith, which preserves low-latency in-process simulation.
- Domains gain stable public APIs suitable for deterministic scenarios, replay, load testing, and future district workers.
- Controller facades can still become large; they must delegate rules to pure policies rather than absorb them.
- Extraction is incremental, but adding gameplay directly to the room is no longer acceptable temporary work.

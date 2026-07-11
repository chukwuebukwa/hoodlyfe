# Vehicle Catalog and Traffic Awareness Research

Date: 2026-07-10

Primary behavioral reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference separates model content, player physics, route ownership, and traffic awareness.

- `CAutomobile` resolves a model's handling data once and consumes mass, turn mass, center of mass, dimensions, acceleration/transmission, braking, traction, drive type, suspension, buoyancy, and behavior flags. Vehicle identity is content, not scattered model checks.
- Model flags identify buses, vans, large/low vehicles, door layouts, stabilizers, and other physical/presentation differences without making traffic AI own those rules.
- Traffic autopilot retains previous/current/next route nodes, lane offsets, curve progress, cruise/max-traffic speed, driving style, temporary actions, and recovery timers.
- `CCarCtrl::FindMaximumSpeedForThisCarInTraffic` scans bounded spatial sectors, reduces a desired maximum speed for cars and pedestrians, and treats driving style as policy.
- `SlowCarOnRailsDownForTrafficAndLights` approaches higher target speed slowly and lower target speed much faster. Braking and acceleration are deliberately asymmetric.
- Traffic lights attach stop semantics to path links. Vehicles decide whether to stop from their current/next link, direction, light phase, and distance to the stop line.
- Simple ambient route following and full physical vehicles share model data but have different simulation cost. Interesting/on-screen/player-relevant vehicles are protected from ordinary cleanup.

References:

- [`Automobile.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Automobile.cpp)
- [`CarCtrl.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp)
- [`CarAI.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarAI.cpp)
- [`TrafficLights.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/TrafficLights.cpp)
- [`HandlingMgr.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/HandlingMgr.h)

The reference was used to identify production ownership and missing nuance. NOCK0 uses an original TypeScript content model, formulas, tuning, and tests.

## Shared Vehicle Catalog

`shared/content/vehicle-catalog.ts` is the immutable source for simulation and presentation model metadata. Stable NOCK0 content IDs do not expose GTA2 model numbers or sprite filenames.

Each current original model defines:

- class, display label, seats, and collision footprint;
- maximum health, mass, and collision damage response;
- forward/reverse acceleration, coast/brake rates, forward/reverse speed caps;
- steering rate and speed-dependent grip response;
- traffic cruise, acceleration, braking, minimum gap, following time, pedestrian gap, and look-ahead range;
- presentation frame, dimensions, and emergency-light capability.

Current development models:

- Sedan: balanced civilian baseline.
- Taxi: lighter durability, lower speed/acceleration, tighter steering, and more conservative traffic gap.
- Police Cruiser: higher durability, acceleration, braking, speed, and emergency-light presentation.

Vehicle access consumes catalog seating. Player simulation consumes catalog handling. Damage/collision consume health and mass. Population consumes traffic cruise policy. Client rendering consumes only presentation metadata.

## Traffic Awareness Contract

`TrafficAwarenessSystem` is a pure desired-speed policy. It does not move a car or choose roads.

1. Build a model-specific scan distance from current speed, following time, braking distance, and configured look-ahead cap.
2. Project nearby vehicles and on-foot actors into the car's forward/lateral frame.
3. Ignore actors behind the car or outside its collision-aware lane corridor.
4. Calculate surface gap, lead-car forward speed, closing speed, safe gap, and stopping-speed limit.
5. Return the most restrictive deterministic result: `cruise`, `vehicle`, or `pedestrian` plus obstacle ID and gap.
6. `TrafficController` approaches the result with slower acceleration and faster braking.

World blockage remains route ownership. A blocked car records the deadline, reverses through validated road space, and chooses a deterministic alternate road neighbor after the bounded reverse phase. Stationary lead vehicles use a separate reverse/pass/merge maneuver; traffic signals and protected queues suppress it.

`VehicleSimulationController` adapts the shared spatial queries into plain traffic obstacles. Traffic awareness does not import district state, the room, wanted, missions, or rendering.

## Debug Contract

Opt-in F3 vehicle labels now include:

- current speed and configured desired speed;
- reason: `cruise`, `vehicle`, `pedestrian`, `blocked`, or `hijack`;
- limiting obstacle ID and surface gap;
- blocked-route recovery count.

The server snapshot copies this private runtime data. Ordinary clients do not receive traffic intentions.

## Delivered Traffic Depth

- Opposing flows use opposite right-hand offsets from compatibility road-cell centers.
- Intersections serialize approaches through deterministic expiring reservations.
- Ambient pedestrians spawn and wander away from roads; direct lane blockers permit a bounded detour.
- Streamed traffic has 64 potential records, a 24-car active ceiling, actual-lane spawn capacity checks, and gameplay pinning.
- Per-model length/width drives oriented-box car collision; catalog radius is no longer the narrow-phase shape.

## Deferred Production Nuance

- Replace road cells with authored, versioned lane centerlines, direction, speed limits, turn links, stop lines, parking, and vehicle-class restrictions.
- Replace compatibility offsets and reservations with authored directed lanes, legal turn connectors, segment capacity, turn radii, and merge priority before allowing materially denser crossing flows.
- Expand local steering/lane changes around disabled vehicles while preserving deterministic collision primitives.
- Add police driving missions such as follow, intercept, ram, block, contain, and roadblock through a police-to-driving intent contract.
- Extend traffic level of detail with zone/time/player-speed density policy and authored offscreen route progress.
- Add original compact, sports, van, truck, bus, motorcycle, ambulance, fire, and special frames before exposing those content IDs in public runtime state.
- Validate larger footprints, seat layouts, door/access points, passenger rendering, and road compatibility per class.

## Acceptance Coverage

- Every current model has a complete bounded catalog definition and valid presentation frame.
- Taxi, Sedan, and Police Cruiser produce distinct authoritative acceleration under equal input.
- Reverse input brakes a forward-moving car with model braking before accelerating backward.
- Ahead lead cars reduce desired speed; behind, adjacent-lane, and distant actors do not.
- Pedestrians inside the forward corridor can demand a complete stop.
- Obstacle ordering cannot change the selected limiting result.
- Traffic braking and diagnostics reflect the selected reason.
- World blockage records and deterministically advances recovery ownership.
- Hijacking still brakes/releases traffic before the player receives control.
- Production build and the complete two-client gameplay suite remain green.

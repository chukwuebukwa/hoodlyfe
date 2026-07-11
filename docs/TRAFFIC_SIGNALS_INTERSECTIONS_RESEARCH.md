# Traffic Signals and Intersection Ownership Research

Date: 2026-07-10

This study defines the first signal-aware traffic slice without treating the GTA2 compatibility road mask as production lane topology or putting intersection rules into ambient/police strategy controllers.

## Production References

Pinned local source: `/tmp/nock0-GTAviceCity` at `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

### Path-Link Annotation

- `CTrafficLights::ScanForLightsOnMap` scans authored light objects during setup, projects each light against nearby car path links, assigns one of two phase families, and stores a directional side flag on the link.
- Traffic lights therefore annotate authored route links. They are not inferred every frame from broad collision or drivable-area geometry.
- Pedestrian crossing links carry a separate traffic-light bit and walk phase. NOCK0 defers crossings until it has an authored sidewalk graph.

### Phase and Stop Policy

- `LightForCars1` and `LightForCars2` share a 16,384 ms global cycle: five seconds green plus one second yellow for the first family, five seconds green plus one second yellow for the second, and an all-red clearance period.
- `ShouldCarStopForLight` inspects current/next/previous route links, verifies travel direction against the link-side flag, and only returns true inside a short approach window. Cars that have crossed the line are not frozen by a phase change.
- Yellow is treated as a stop phase. The driving layer converts the stop reason into speed reduction; the signal system does not directly mutate vehicle movement.
- Off-camera traffic deletion explicitly excludes cars stopped for lights or bridges, preserving queues rather than despawning them as blocked clutter.

### Driving, Occupancy, and Emergency Response

- `SlowCarOnRailsDownForTrafficAndLights` combines the signal stop reason with the ordinary vehicle/pedestrian speed scan, then uses asymmetric deceleration/acceleration toward the selected maximum speed.
- Cross-traffic safety still depends on ordinary vehicle awareness. NOCK0 will make intersection occupancy explicit because its current route cells are wider and less lane-precise than the production path links.
- Police pursuit uses a different driving style from ordinary stop-for-cars traffic. `MakeWayForCarWithSiren` is a separate nearby-vehicle behavior that identifies relevant moving traffic ahead and assigns a bounded swerve/wait action. Signal bypass and civilian yielding must remain separate policies.
- Wrecks are physical world obstacles. NOCK0 currently excludes destroyed cars from traffic awareness even though collision still blocks them; this slice will classify wrecks as stationary awareness obstacles.

### Stuck Recovery and Passing

- `CCarAI::UpdateCarAI` resets its anti-reverse timer while a car is moving. A non-mission car that remains at very low speed without a legitimate stop reason receives a bounded reverse action, sounds its horn, and promotes from ordinary stop-for-cars behavior to avoid-cars behavior.
- `CCarCtrl::SlowCarDownForOtherCar` predicts overlap with moving rectangles and applies proximity speed limits. When opposing cars remain stopped for roughly 15 seconds, stable ordering selects one car to break the deadlock instead of allowing both to make conflicting decisions.
- `SteerAICarWithPhysics` implements temporary `REVERSE`, `SWERVELEFT`, and `SWERVERIGHT` actions with deadlines. The swerve reverses steering near the end to rejoin the route rather than becoming a permanent lane offset.
- `CarHasReasonToStop` resets the anti-reverse timer for legitimate traffic, bridge, and light stops. A queue at a red light must not be diagnosed as broken traffic.
- NOCK0 adapts this into `TrafficManeuverSystem`: two seconds behind the same stationary vehicle starts a deterministic, bounded reverse/pass/merge plan only after both side paths are probed against collision, road, and nearby-obstacle geometry. Signals and pedestrians within the protected approach suppress passing.
- This is deliberately a temporary maneuver layer over route following. It does not claim to be a full lane-change model; authored lane centerlines remain the prerequisite for production passing priority and turn-lane behavior.

## Compatibility Map Audit

- The current 64 x 64 road layer contains 1,861 road cells.
- A degree scan marks 1,788 cells as having three or four road neighbors because the layer describes broad multi-cell road surfaces, not centerline links.
- Automatic intersection detection from neighbor count is rejected. Signals use a finite authored content catalog with measured center, bounds, approaches, stop points, direction, and phase family.
- Two first-slice sites were measured against `CollisionMap.isRoadAt` and `canOccupy(..., 20)`:
  - Foundry Crossing centered at `(2400, 960)` with four approaches.
  - Threads Junction centered at `(2400, 2112)` with north/south and westbound approaches.
- Every authored stop point is road-valid and vehicle-clearance safe. These compatibility coordinates must later move into the original city authoring/export pipeline.

## NOCK0 Boundary

- Shared signal content owns stable IDs, display position, intersection bounds, directional stop approaches, and the global phase clock.
- `TrafficSignalController` validates authored points once, projects replicated phase state, selects only a relevant ahead-facing approach, checks cross-axis occupancy, and returns zero or one virtual stop obstacle.
- `TrafficAwarenessSystem` treats a returned signal as a stationary obstacle and computes braking speed with the existing model-specific gap/following/deceleration policy.
- `TrafficController` and `PoliceVehicleController` continue to own route/strategy. Ambient traffic consumes signal obstacles; active emergency response explicitly bypasses them. Later siren yielding will consume a separate emergency-corridor fact.
- `VehicleSimulationController` composes nearby physical and signal obstacles. Destroyed vehicles remain stationary physical obstacles instead of disappearing from awareness.
- The client renders replicated light phases and authored stop-line presentation only. It never predicts phase authority or decides whether a car may enter.
- `DistrictRoom` owns construction, initialization, and update order only.

## First-Slice Phase Policy

- Global cycle: 16,000 ms.
- North/south green: 0-5,000 ms; yellow: 5,000-6,000 ms.
- East/west green: 6,000-11,000 ms; yellow: 11,000-12,000 ms.
- Both axes red: 12,000-16,000 ms.
- Non-green phases create a virtual stop obstacle only for vehicles before the line, facing the authored approach, inside its corridor and scan range.
- A green approach is also held when a living, nondestroyed cross-axis vehicle occupies the authored intersection box.
- Emergency response bypass is explicit and diagnostic; idle/parked police do not move through the controller.

## Ambient Traffic Budget

- The compatibility district now starts 16 moving traffic vehicles plus three service/parked vehicles. Spawning probes up to 24 deterministic road candidates per vehicle and prefers at least 64 px separation from every already-created vehicle.
- Sixteen is an explicit first-room observation budget, not an assumed final density. A later population manager must use per-district budgets, player-interest zones, spawn/despawn hysteresis, and server tick telemetry before density increases further.
- Traffic diagnostics expose maneuver phase and attempt count. F3 also draws authored intersection bounds and stop lines and reports replicated phase plus waiting vehicle IDs.

## Deferred Scope

- Authored lane centerlines, legal turn connectors, turn arrows, stop signs, pedestrian crossings/walk phases, per-intersection offsets, protected turns, queue spillback, player traffic-law enforcement, and signal damage/outage.
- Dynamic population interest management, traffic LOD, parked/ambient conversion, density presets, and tick-budget backpressure.
- Siren yielding with bounded pull-aside/wait actions after signal behavior is stable.
- Coordinated police blocks and roadblocks after lane/intersection ownership exists across the full district.

## QA Gate

Required evidence includes phase boundaries and next-change timestamps, authored-point validation, ahead/behind/wrong-heading filtering, red/yellow stop, green release, cross-axis occupancy hold, same-axis pass, emergency bypass, signal-aware braking, wreck awareness, replicated phase state, client color/stop-line projection, traffic diagnostics, real two-client regression, production build, live browser phase change, visible stopped/released traffic where reachable, and a fresh clean log window.

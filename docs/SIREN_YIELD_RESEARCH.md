# Emergency Siren Yield Research

Updated: 2026-07-11

## Goal

Allow active police response vehicles to move through ordinary traffic without making police strategy own civilian road behavior or treating every siren as a global stop command.

## Production Reference

Pinned clean-room reference: `daynz/GTAviceCity`, primarily:

- `src/vehicles/Automobile.cpp` around the periodic siren make-way call;
- `src/control/CarAI.cpp`, `CCarAI::MakeWayForCarWithSiren`.

The production implementation:

- runs only for a moving siren vehicle;
- projects a speed-scaled corridor ahead of that vehicle;
- considers nearby random civilian cars rather than all world vehicles;
- ignores law-enforcement and other emergency vehicles;
- requires compatible elevation and active vehicle state;
- makes strongly aligned traffic swerve away from the siren path for a temporary interval;
- makes conflicting traffic wait instead of performing the same swerve;
- expires temporary actions so normal autopilot resumes.

## NOCK0 Translation

`EmergencyYieldSystem` is a generic traffic-domain policy. It consumes immutable emergency snapshots and owns only a small per-traffic-car temporary runtime:

- siren vehicle identity;
- `yield-left`, `yield-right`, or `wait` phase;
- expiration time;
- temporary road-validated target.

The system rejects silent, stopped, destroyed, behind, distant, and lateral-out-of-corridor emergency vehicles. Strongly same-direction civilian traffic selects a road-safe side away from the cruiser path, falls back to the opposite side, and waits when neither side is safe. Oncoming and crossing traffic wait. The normal `RoadDrivingSystem` still owns steering, acceleration, braking, collision-aware speed, and world occupancy.

Police strategy is unchanged. `PoliceVehicleController` only publishes the already-replicated siren fact; `VehicleSimulationController` supplies nearby siren snapshots to ordinary traffic. Deadlock recovery is suspended during the bounded emergency action so yielding is not mistaken for a blocked route.

## Diagnostics and Limits

- Traffic diagnostics expose `speedReason: siren`, phase, and emergency vehicle ID.
- Phaser text diagnostics include the yield phase.
- Three F3 draws cyan yield or yellow wait links between the civilian and emergency vehicle.
- Selection is deterministic by distance then stable ID.
- The corridor is capped at 340 world units and each temporary action lasts 1.8 seconds.

## Deferred Nuance

- Authored lane shoulders and legal pull-over pockets should replace broad road-mask side probes.
- Multiple emergency vehicles may eventually need priority and corridor reservations.
- Pedestrian siren reactions, player-controlled sirens, ambulance/fire response, and audio occlusion are separate slices.

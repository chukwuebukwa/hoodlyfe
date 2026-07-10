# Player Control Research and Modular Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

Player control is a pipeline, not one session-level update function.

- `CPad` owns current and previous raw controller states, input-source mapping, clear/reset behavior, disabled-control masks, held controls, and just-pressed edges.
- `CPlayerPed::ProcessControl` gates control by explicit pedestrian state. Dead, dying, driving, entering/exiting, carjacking, falling, and scripted/objective states do not all consume movement or weapons identically.
- `PlayerControlZelda`, first-person, fighter, sniper, and M16 paths convert the same pad axes into mode-specific heading, acceleration, movement, and aiming behavior.
- On-foot movement derives vector magnitude and heading before applying acceleration. Turning and move animation follow locomotion state rather than reading keys directly throughout the codebase.
- Player weapon processing is separate from locomotion, and vehicle control returns through the vehicle path while the player is driving.
- `CPlayerInfo::Process` owns player-level interactions such as enter/exit requests and restart state; it does not replace ped locomotion, weapon, vehicle, or wanted owners.

References:

- [`Pad.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Pad.h)
- [`Pad.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Pad.cpp)
- [`PlayerPed.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PlayerPed.h)
- [`PlayerPed.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PlayerPed.cpp)
- [`PlayerInfo.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/PlayerInfo.h)
- [`PlayerInfo.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/PlayerInfo.cpp)

The reference is used to study ownership and behavior only. NOCK0 remains an original authoritative multiplayer implementation.

## NOCK0 Adaptation

The first extraction introduces `PlayerControlController` with one narrow responsibility:

1. Own the latest validated move intent for each connected player.
2. Convert unknown wire values to finite normalized axes and reject invalid values as neutral input.
3. Validate aim state and normalize accepted angles.
4. Provide the same control state to on-foot and vehicle simulation without exposing its runtime map.
5. Apply collision-safe on-foot locomotion only when the player is alive, not performing an action, and not occupying a vehicle.
6. Clear intent on death and unregister it on disconnect.

The room remains responsible for network admission and message registration. `VehicleSimulationController`, `FireControlController`, `VehicleAccessController`, and `PlayerLifecycleController` remain the owners of driving, weapons, seating/actions, and death/respawn.

## Required Online Nuance

The current latest-intent model is sufficient for the playable slice but the protocol must evolve before competitive or valuable gameplay:

- Every input command needs a monotonically increasing sequence number, client sample time, and server receive time.
- The server must reject old/out-of-order commands, enforce an input rate budget, cap queued commands, and expire stale held input after a short timeout.
- Client prediction and server reconciliation must replay unacknowledged commands against authoritative positions; clients never submit positions or speed.
- Movement modes become data-driven and state-gated: idle, walk, run, sprint, aiming, reloading, hit reaction, knocked down, entering/exiting, arrested, and scripted control.
- Acceleration, deceleration, turn rate, weapon restrictions, surface modifiers, crowd separation, and animation intent belong to locomotion/content modules, not room branches.
- Controls need explicit disable reasons for death, UI/modal focus, mission staging, cutscenes, arrest, and server correction instead of one ambiguous boolean.
- Browser focus loss, touch cancellation, disconnect, death, district transfer, and rejected actions must clear held controls.
- Anti-cheat validates reachable displacement against authoritative mode, collisions, status effects, and server time; it does not trust client animation or frame rate.

## Acceptance Tests for This Extraction

- Registration creates neutral intent; reset and unregister clear it.
- Non-finite wire values become zero and finite axes clamp to `[-1, 1]`.
- Diagonal input is normalized so it cannot exceed straight-line speed.
- On-foot movement uses fixed-step delta and collision-safe axis resolution.
- Dead, action-locked, and vehicle-occupying players do not move on foot.
- Drivers expose the same validated intent to vehicle simulation.
- Aim rejects dead/action/driver states, permits on-foot and passenger states, and normalizes finite angles.
- Existing two-client movement, driving, passenger aim/fire, death, and respawn behavior remains green.

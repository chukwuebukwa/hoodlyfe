# Freemode Mission Presentation Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

- Mission scripts own objective truth and publish timer/counter/blip/message intent through bounded engine APIs.
- `CUserDisplay::OnscnTimer` stores timer/counter facts while `CHud` owns their formatting, flashing, and drawing.
- Radar blips and 3D markers are presentation records managed separately from mission script execution.
- Mission title, odd-job success/failure, pager/help, timer, counter, and world/radar marker channels have distinct lifecycles.
- Script cleanup removes owned markers/timers/entities rather than relying on the renderer to infer completion.

References:

- [`Script.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script.h)
- [`Script.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script.cpp)
- [`Hud.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/renderer/Hud.cpp)

The reference is used for clean-room ownership and behavior study. NOCK0 remains an original client implementation.

## NOCK0 Extraction

- Pure `mission-presentation-policy.ts` selects active/joinable work and projects HUD, action command, minimap points, contact, target, and delivery markers from replicated state.
- `MissionPresentationController` owns mission DOM, action-button listener/command dispatch, Phaser world graphics, state reference, and teardown.
- `ClientInputController` no longer reads mission DOM or dispatches mission commands.
- `DistrictScene` supplies replicated state and asks only for draw/minimap outputs.

## Required Nuance

- Active participant work takes priority over nearby joinable work and the street contact.
- Joinability is deterministic, capped, forming-only, and distance-limited to the leader.
- Only the leader can launch or abandon with the current rules; nonleaders get no misleading action.
- Completed/failed work remains readable while its replicated record exists but exposes no invalid action.
- World and minimap objectives use the same phase-derived source.
- Missing targets/players/vehicles degrade cleanly and never mutate mission state.
- Listeners, graphics, and state references are removed on shutdown.
- Future renderer adapters should consume the same projection for Phaser or Three markers.

## Acceptance Tests

- Street contact, joinable crew, leader launch, member wait, active abandon, and terminal phases project correctly.
- Steal/lose-heat phases point to the target; deliver points to the delivery zone.
- Participant priority, join distance, roster capacity, timer formatting, payout metadata, and failure text are deterministic.
- Live start/join/launch/abandon action dispatch and minimap/world marker behavior remain intact.

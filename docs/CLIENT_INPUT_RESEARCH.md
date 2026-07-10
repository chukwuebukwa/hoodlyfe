# Browser Input and Command Adapter Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

- `CPad` owns device state, current/previous samples, disabled-control masks, held-versus-edge controls, input-mode mapping, clear/reset, and controller-loss behavior.
- `CPlayerPed` receives normalized pad intent and applies state/mode-specific movement, aim, and weapon rules; it does not bind browser or platform devices.
- `CPlayerInfo` converts higher-level enter/exit intent into player objectives while vehicle and ped systems own execution.
- Presentation such as aim rotation and movement animation reacts to accepted local intent but does not replace authoritative world state.

References:

- [`Pad.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Pad.h)
- [`Pad.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Pad.cpp)
- [`PlayerPed.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PlayerPed.cpp)
- [`PlayerInfo.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/PlayerInfo.cpp)

The reference is used to study behavior and ownership only. NOCK0 remains an original browser/server implementation.

## NOCK0 Extraction

The client input slice has two layers:

1. `client-input-policy.ts` is framework-independent. It normalizes combined keyboard/touch movement, applies gameplay-state gates, and owns movement heartbeat/change and aim/fire/weapon cadence.
2. `ClientInputController` binds Phaser keyboard/pointer/wheel and DOM/touch controls, samples local intent, sends protocol commands, and reports local aim/movement intent back to the scene for presentation/prediction.

`DistrictScene` remains the Phaser lifecycle coordinator. It receives one movement vector per frame for prediction and an aim callback for sprite presentation. The server remains authoritative for movement, ammunition, cooldowns, seats, actions, and mission transitions.

## Required Production Nuance

- Input listeners are installed once and removed on scene shutdown; hidden/recreated scenes cannot send duplicate commands.
- Browser blur, visibility loss, touch cancellation, game shutdown, death, and disconnect send or establish neutral held input.
- Movement uses change detection plus a bounded heartbeat; aim/fire/weapon commands have independent cadence.
- Keyboard and analog inputs combine before unit-length normalization; analog magnitude is preserved below one.
- UI controls prevent propagation where pointer fire would otherwise leak through.
- Command eligibility uses replicated state for immediate UX but never grants authority.
- The next protocol phase adds command sequence, client sample time, server acknowledgement, stale-command rejection, rate budgets, and prediction replay.
- Input mode, bindings, accessibility settings, dead zones, sensitivity, aim assist, vibration, and remapping belong to device/profile configuration rather than scene branches.
- DOM queries should become cached typed UI bindings as the HUD is extracted.
- Focus/modal/chat states need explicit disable reasons and a neutral-input flush.

## Acceptance Tests

- Partial analog magnitude is preserved and combined keyboard/touch input cannot exceed unit length.
- Movement sends immediately on meaningful change, obeys the minimum interval, and heartbeats unchanged input.
- Aim, fire, and weapon cycling use independent cadence.
- Dead, action-locked, and driver states cannot aim/fire/cycle; passengers can.
- Phaser scene shutdown removes wheel and DOM handlers and sends neutral movement.
- Existing keyboard, touch, pointer fire, wheel/Q/E cycling, F interaction, vehicle button, and mission action behavior remains available.

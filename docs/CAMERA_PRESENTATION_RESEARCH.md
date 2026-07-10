# Camera Presentation Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

- `CCamera` owns the active target, follow mode, switching policy, interpolation state, restored state, and script/game control priority.
- Pedestrian and vehicle following are distinct camera modes even when both ultimately track one authoritative entity.
- `RestoreWithJumpCut` explicitly selects the player vehicle or ped and resets transition state. Target changes are not inferred independently by render objects.
- Shake is a transient camera effect applied after camera positioning. Positional shake attenuates by distance, decays over time, and only replaces a stronger still-active shake when appropriate.
- Debug/script camera modes are separate from ordinary gameplay following.

References:

- [`Camera.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Camera.h)
- [`Camera.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Camera.cpp#L1868)

The reference is used for clean-room ownership and behavior study. NOCK0 remains an original browser implementation.

## NOCK0 Extraction

- `CameraPresentationController` owns Phaser camera bounds/background, responsive zoom, current target identity, player/vehicle follow settings, local damage feedback, resize listener lifecycle, and shutdown teardown.
- Player and vehicle renderers report eligible targets through callbacks; they never call Phaser cameras directly.
- Pure `camera-policy.ts` owns responsive zoom and mode-specific follow lerp so a future Three renderer can implement the same decision contract.

## Required Nuance

- Target changes are idempotent and keyed by authoritative entity ID.
- Player and vehicle follow use separately tuned smoothing.
- Initial on-foot acquisition can center immediately; ordinary updates remain smooth.
- Damage feedback is driven once per authoritative health decrease, never every render frame.
- Resize listeners are installed once and removed on scene shutdown.
- Future camera states need explicit gameplay, mission/script, spectator, death, interior, and debug ownership priority.
- The Three renderer must preserve policy and lifecycle while replacing only the camera adapter.

## Acceptance Tests

- Responsive zoom returns stable mobile and desktop values at the breakpoint.
- Player and vehicle follow modes retain distinct lerp values and target keys.
- Scene shutdown removes the resize listener.
- Live player-to-vehicle-to-player transitions keep the correct target and HUD without a runtime error.

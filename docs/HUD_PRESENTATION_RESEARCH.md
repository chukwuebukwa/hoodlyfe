# Local HUD Presentation Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

- `CHud` owns current HUD visibility, weapon sprites, meter/counter presentation, flash state, current/previous messages, message timers, fade state, and display channels.
- Gameplay systems set facts or messages; the HUD decides how those facts are formatted, timed, faded, suppressed, or queued.
- Help, pager, subtitle, zone, vehicle, mission, and large failure/success messages are distinct channels with independent state rather than one global text field.
- Timed messages retain previous values and transition state so repeated frame updates do not restart presentation.

References:

- [`Hud.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/renderer/Hud.h)
- [`Hud.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/renderer/Hud.cpp)

The reference is used for clean-room ownership and behavior study. NOCK0 remains an original DOM HUD implementation.

## NOCK0 Extraction

- Pure `hud-policy.ts` projects replicated player/vehicle facts into labels, percentages, visibility, mode, and icon data.
- The policy compares previous/current local state to emit edge-triggered heat, cash, and vehicle-action notices without DOM access.
- `LocalHudController` caches DOM references once, applies projections, manages a bounded notice queue, owns connection display, and clears timers/queue on shutdown.
- Mission and debug panels remain separate presentation owners. Mission transport may submit a notice to the HUD channel but cannot mutate HUD internals.

## Required Nuance

- Initial synchronization establishes a baseline and does not falsely announce existing cash, wanted heat, or action state.
- Meter percentages are finite and clamped; malformed replicated presentation data cannot produce invalid CSS.
- Driver, passenger, on-foot, action, dead, and temporarily missing vehicle records have stable visibility rules.
- Repeated state patches do not repeat transition notices.
- Toast volume is bounded and consecutive duplicates are suppressed.
- Timer teardown prevents a destroyed scene from mutating reused DOM.
- Future channels need explicit priority/interruption rules for mission success/failure, death/arrest, phone/contact, pickups, help, and social messages.

## Acceptance Tests

- Player/vehicle projection covers foot, driver, passenger, dead, weapon, speed, health, and component condition.
- Transition notices fire once for wanted escalation/loss, cash gain, entering, and hijacking, but not on initial sync or unchanged patches.
- Live weapon cycling, enter/exit HUD swap, cash/heat display, connection state, and mission notices remain intact.

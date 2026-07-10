# Player and Vehicle Rendering Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

- `CPed::Render` decides whether an in-vehicle pedestrian is rendered, applies a distance/LOD gate, and attaches the selected weapon model to the ped's hand. Occupancy does not merge the pedestrian into vehicle gameplay state.
- `CVehicle` owns stable driver/passenger slots plus explicit getting-in/getting-out flags. Seat assignment and transition state are authoritative inputs to presentation.
- Enter, hijack, drag-out, and exit flows use explicit animation states and completion callbacks. Rendering reacts to these states; an animation callback does not independently grant a seat.
- `CAutomobile::PreRender` derives wheel, skid, exhaust, lights, shadows, and damage particles from authoritative vehicle state and visibility. Effects are presentation work performed before the model render.
- `CAutomobile::AddDamagedVehicleParticles` stages steam, smoke, and fire by engine/component state and suppresses unnecessary effects by view/speed conditions. A single generic low-health particle is not the production model.
- `CAutomobile::Render` updates model components such as wheel rotation immediately before entity rendering, keeping component presentation with the vehicle renderer.

References:

- [`Ped.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Ped.cpp#L4838)
- [`PedAI.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedAI.cpp#L2220)
- [`Vehicle.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Vehicle.h)
- [`Vehicle.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Vehicle.cpp)
- [`Automobile.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Automobile.cpp#L1243)

The reference is used for clean-room ownership and behavior study. NOCK0 remains an original Phaser implementation.

## NOCK0 Ownership

### Player Renderer

- Own player sprites, passenger sprites, weapon images, labels, interpolation targets, local correction rate, action presentation, and deterministic teardown.
- Read replicated alive/action/vehicle/seat/weapon state; never assign seats, ammo, health, position, or action completion.
- Ask `VehicleRenderer` for a read-only presentation pose when composing passengers and labels.
- Report local-state and local-damage presentation through narrow callbacks so HUD and camera ownership can move independently.
- Own passenger peek/recoil as cosmetic state triggered by authoritative projectile appearance.

### Vehicle Renderer

- Own vehicle containers, body sprite, police lights, staged damage effects, interpolation targets, depth, and teardown.
- Expose a read-only pose lookup for player composition; do not expose mutable Phaser children.
- Report local occupancy through a narrow camera-follow callback.
- Derive visual stage from replicated health, engine damage, fire, destruction, kind, and occupancy without mutating simulation state.

## Production Nuance to Preserve

- Player and vehicle render caches are keyed by authoritative IDs and destroy stale objects exactly once.
- Drivers remain hidden by the vehicle; passengers use stable seat anchors and explicit outward peek directions.
- Nameplates follow the effective player position, including drivers/passengers, and resolve overlap deterministically.
- Weapon models stay attached to the effective ped/seat pose and preserve aim/recoil independently of the vehicle's heading.
- Local on-foot prediction is cosmetic and collision-aware; authoritative targets always correct it.
- Local/remote players and local/remote vehicles have different correction rates and snap thresholds.
- Damage effects are staged: healthy, damaged tint, engine smoke, on fire, wreck. Future component sprites can use front/rear/left/right damage without changing the renderer boundary.
- Effects should later be culled by camera bounds and pooled when profiling shows allocation pressure.
- Camera follow, HUD, audio, and screen feedback consume callbacks and must not reach into renderer caches.
- Enter/hijack/exit animation phases need richer replicated action state before production animations can replace the current pulse; the server remains the authority on completion.

## Acceptance Tests

- Weapon and vehicle visual policies map every current content kind to stable presentation data.
- Seat anchors place front-right, rear-left, and rear-right passengers on distinct outward-facing sides.
- Passenger recoil shifts opposite aim while preserving the seat anchor.
- Healthy, damaged, smoking, burning, and wrecked vehicles derive distinct visual stages.
- Player/vehicle synchronization creates, updates, and destroys keyed render objects without changing replicated state.
- Local prediction, remote interpolation, wrapped rotation, labels over cars, passenger peek/fire, police lights, smoke/fire, camera following, and HUD remain visible in browser QA.

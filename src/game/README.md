# Client Game Modules

The browser client presents replicated server state, collects player intent, and performs cosmetic prediction/interpolation. It never decides gameplay outcomes.

## Dependency Direction

```text
DistrictScene
  -> input and presentation controllers
    -> pure client policies
  -> network protocol/state views
  -> Phaser and DOM adapters
```

Rules:

- `DistrictScene` owns Phaser lifecycle and coordinates focused client modules.
- Pure policies do not import Phaser, Colyseus, browser globals, or DOM elements.
- Device/DOM adapters install listeners once and remove them on scene shutdown.
- Server commands carry intent only; the browser never sends position, damage, cash, wanted state, mission outcomes, or vehicle health.
- Prediction and interpolation are presentation. Replicated authoritative state always corrects them.
- HUD, minimap, debug, entity rendering, audio, and effects consume state/events through narrow inputs rather than reaching across each other.

## Current Modules

```text
game/
  camera/
    camera-policy.ts
    camera-presentation-controller.ts
  debug/
    debug-panel-policy.ts
    debug-presentation-controller.ts
    debug-snapshot-subscription.ts
  input/
    client-input-controller.ts
    client-input-policy.ts
  missions/
    mission-presentation-policy.ts
    mission-presentation-controller.ts
  rendering/
    interpolation-policy.ts
    pedestrian-renderer.ts
    player-render-policy.ts
    player-renderer.ts
    projectile-render-policy.ts
    projectile-renderer.ts
    render-types.ts
    vehicle-render-policy.ts
    vehicle-renderer.ts
  ui/
    hud-policy.ts
    local-hud-controller.ts
  minimap-marker-policy.ts
  minimap-renderer.ts
  touch-controls.ts
  district-scene.ts
```

- `client-input-policy.ts` owns framework-independent movement normalization, gameplay-state gates, and independent command cadence.
- `camera-policy.ts` owns renderer-independent responsive zoom and player/vehicle follow decisions.
- `CameraPresentationController` owns Phaser target identity, following, damage feedback, resize binding, and teardown.
- `DebugSnapshotSubscription` installs the snapshot handler before opting in, and owns unsubscribe/listener teardown.
- `debug-panel-policy.ts` projects snapshot/state fallback counters and bounded event text without DOM or Phaser.
- `DebugPresentationController` composes transport, F3/button input, cached panel DOM, sampled world overlays, label lifecycle, and teardown.
- `ClientInputController` owns Phaser keyboard/pointer/wheel and DOM/touch bindings, command publication, aim presentation callbacks, and listener teardown.
- `mission-presentation-policy.ts` owns active/joinable selection plus HUD, command, minimap, contact, target, and delivery projection.
- `MissionPresentationController` owns mission DOM, action dispatch, Phaser world markers, replicated-state reference, and teardown.
- `TouchControls` owns touch-stick state and now provides deterministic listener/media-query cleanup.
- `interpolation-policy.ts` owns framework-independent render correction and wrapped-angle interpolation.
- `PedestrianRenderer` owns NPC render-object creation, synchronization, animation, interpolation, visibility, depth, removal, and teardown.
- `PlayerRenderer` owns player/weapon/passenger/nameplate render objects, prediction, interpolation, seat composition, recoil, and teardown.
- `projectile-render-policy.ts` owns weapon/police projectile presentation data.
- `ProjectileRenderer` owns bullet render-object creation, synchronization, interpolation, muzzle flashes, removal, and teardown.
- `ThrownProjectileRenderer` owns replicated grenade ground/shadow/height composition, fuse pulse, interpolation, and teardown.
- `ExplosionRenderer` edge-triggers each replicated explosion ID once and owns blast core/ring/particle/camera feedback lifecycle; it never selects victims.
- `WeaponPickupRenderer` owns available pickup model/label/pulse lifecycle and pure minimap-point projection.
- `VehicleRenderer` owns vehicle bodies, police lights, damage stages/effects, interpolation, read-only poses, and teardown.
- `hud-policy.ts` projects player/vehicle facts and edge-triggered notices without DOM access.
- `LocalHudController` owns cached HUD elements, meters, mode visibility, bounded notices, connection state, timers, and teardown.
- `DistrictScene` now owns world/bootstrap wiring, state fan-out, update order, local collision queries, vehicle-action affordance, and crosshair/minimap coordination.

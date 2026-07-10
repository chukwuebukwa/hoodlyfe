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
    debug-snapshot-subscription.ts
  input/
    client-input-controller.ts
    client-input-policy.ts
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
- `ClientInputController` owns Phaser keyboard/pointer/wheel and DOM/touch bindings, command publication, aim presentation callbacks, and listener teardown.
- `TouchControls` owns touch-stick state and now provides deterministic listener/media-query cleanup.
- `interpolation-policy.ts` owns framework-independent render correction and wrapped-angle interpolation.
- `PedestrianRenderer` owns NPC render-object creation, synchronization, animation, interpolation, visibility, depth, removal, and teardown.
- `PlayerRenderer` owns player/weapon/passenger/nameplate render objects, prediction, interpolation, seat composition, recoil, and teardown.
- `projectile-render-policy.ts` owns weapon/police projectile presentation data.
- `ProjectileRenderer` owns bullet render-object creation, synchronization, interpolation, muzzle flashes, removal, and teardown.
- `VehicleRenderer` owns vehicle bodies, police lights, damage stages/effects, interpolation, read-only poses, and teardown.
- `hud-policy.ts` projects player/vehicle facts and edge-triggered notices without DOM access.
- `LocalHudController` owns cached HUD elements, meters, mode visibility, bounded notices, connection state, timers, and teardown.
- `DistrictScene` still owns world setup, mission presentation, debug rendering, and crosshair/minimap coordination. Those are the next extraction targets.

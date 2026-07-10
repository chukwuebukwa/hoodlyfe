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
  input/
    client-input-controller.ts
    client-input-policy.ts
  minimap-marker-policy.ts
  minimap-renderer.ts
  touch-controls.ts
  district-scene.ts
```

- `client-input-policy.ts` owns framework-independent movement normalization, gameplay-state gates, and independent command cadence.
- `ClientInputController` owns Phaser keyboard/pointer/wheel and DOM/touch bindings, command publication, aim presentation callbacks, and listener teardown.
- `TouchControls` owns touch-stick state and now provides deterministic listener/media-query cleanup.
- `DistrictScene` still owns world setup, replicated entity factories, prediction/interpolation, mission presentation, debug rendering, HUD, and crosshair/minimap coordination. Those are the next extraction targets.

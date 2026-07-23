# Client Game Modules

The browser is a presentation and input client. It sends player intent, renders replicated server state, and never decides movement, collisions, damage, inventory, or mission outcomes.

`DistrictClient` is the client composition root. It owns the scene renderer and coordinates focused modules for input, UI, audio, debug tools, network timing, remote interpolation, interiors, lighting, and entity presentation.

## Dependency Direction

```text
DistrictClient
  -> input and presentation controllers
    -> pure client policies
  -> replicated protocol/state views
  -> scene and DOM adapters
```

Rules:

- Server commands carry intent only; the browser never sends positions or gameplay outcomes.
- Every actor, including the local player and driven vehicle, is rendered from authoritative snapshots.
- Remote motion timelines smooth snapshot delivery without simulating future local state.
- Combat rewind is a server-side historical query; the client does not create provisional projectiles.
- Device and DOM adapters install listeners once and remove them on shutdown.
- HUD, minimap, debug, entity rendering, audio, and effects consume state through narrow inputs.

Client-side prediction and reconciliation were deliberately removed. If responsiveness later requires prediction, introduce it as a separately measured feature rather than keeping a dormant second simulation stack.

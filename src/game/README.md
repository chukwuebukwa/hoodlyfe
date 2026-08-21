# Client Game Modules

The browser is a presentation and input client. It sends player intent, predicts a bounded subset of local movement, renders replicated server state, and never decides authoritative movement, collision, elevation, damage, inventory, or mission outcomes.

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
- The grounded local street player may render from a reconciled predicted pose; all lasting outcomes remain authoritative.
- Unsupported local states and every driven vehicle render from authoritative snapshots.
- Remote motion timelines smooth snapshot delivery without simulating future local state.
- Combat rewind and hit resolution remain server-authoritative. The client may render
  correlated provisional projectiles immediately, but never decides ammo, hits, damage,
  or persistence; each provisional ID must hand off to or be rejected by a server receipt.
- Device and DOM adapters install listeners once and remove them on shutdown.
- HUD, minimap, debug, entity rendering, audio, and effects consume state through narrow inputs.

Local on-foot prediction runs the shared fixed-step movement kernel at 60 Hz, retains 24
input frames, and reconciles against the server's last acknowledged input sequence. It is
rollout-gated and fails closed when the surface manifest is unavailable or the player is
inside an interior, airborne, dead, in a vehicle, or performing an unsupported action.
Canonical physics rewinds immediately; a render-only offset decays after small corrections.

This is the foundation for interaction islands, not the complete system. Nearby dynamic
bodies are not yet promoted into client replay. Driven vehicles use the same bounded
saved-input reconciliation model for their local presentation while authority remains
on the server.

# Police Roadblock Research

Status: G3c implementation contract

## Scope and References

This milestone uses pinned reverse-engineered sources as educational behavior references,
not as reusable code or content. NOCK0's implementation is original TypeScript built around
its authored lane graph, authoritative Colyseus state, and multiplayer ownership rules.

- re3 commit [`3233ffe1c4b99e8efb4c41c6794b4fce880cf503`](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)
- reVC commit [`b9eeb33efcd04a5b7a423921609baef11bf4719a`](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a)

## Production Behaviors Preserved

### Opportunities belong to the world

re3 discovers map objects explicitly marked for roadblock use, while reVC stores potential
roadblock path nodes. Both activate a bounded subset near the pursued player rather than
inventing arbitrary barricades every frame:

- [re3 authored roadblock discovery and activation](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/RoadBlocks.cpp)
- [reVC authored node activation](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/RoadBlocks.cpp#L114-L167)

NOCK0 therefore stores roadblock IDs, centers, headings, blocked lane-edge IDs, and vehicle
poses in `district-lanes.json`. Graph validation rejects missing edges, blocked poses,
duplicate IDs, and malformed geometry at boot.

### Wanted pressure selects policy, not arbitrary police spawns

The reference games expose roadblock density through wanted state, reject unsuitable
activation windows, derive the barrier span from road width/lane count, and validate
physical placement before creating actors. reVC also chooses response vehicle classes from
the active enforcement tier and gives generated actors extended-range ownership:

- [reVC density, lane width, divider handling, and activation hysteresis](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/RoadBlocks.cpp#L119-L159)
- [reVC actor placement and collision validation](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/RoadBlocks.cpp#L192-L267)

NOCK0's pure policy requires heat 3+, a moving suspect vehicle, and an authored opportunity
ahead within a bounded distance. It prefers the intended setup distance, then alignment and
stable slot ID. The controller limits active roadblocks and applies suspect cooldowns.

### Routing closes before actors appear

A multiplayer server cannot safely materialize a barricade into existing streamed traffic.
G3c first acquires owner-scoped lane closures. New ambient traffic cannot spawn or route
through those edges; active routes preserve their current edge, then replan before entering
the closure. The controller waits for route occupants, players, and vehicle poses to clear
before spawning ordinary authoritative police vehicles.

This is a NOCK0-specific extension of the reference behavior. It prevents pop-in and gives
all clients one server-owned closure transition.

### Cleanup follows ownership

Each roadblock owns its closure and generated vehicle IDs. Wanted clearance, timeout,
destruction, displacement, or hijacking moves the runtime into retirement. Unoccupied cars
are removed only outside every street player's protected radius. A hijacked/occupied car
leaves roadblock ownership immediately and survives cleanup; the closure is released only
after the remaining owned barricade is safe to remove.

## Deliberately Deferred: Stingers

reVC's stinger is not a decorative roadblock prop. It has an owner, a bounded global segment
budget, deploy/undeploy animation phases, collision activation, timed expansion, wheel-level
contact tests, tyre mutation, and explicit removal:

- [reVC stinger ownership and deployment admission](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/objects/Stinger.cpp#L35-L118)
- [reVC wheel contact and tyre effects](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/objects/Stinger.cpp#L121-L184)
- [reVC timed deployment lifecycle](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/objects/Stinger.cpp#L186-L258)

G3d must first define original tyre state/damage and a replicated spike-strip actor. It may
consume a G3c slot but must not be folded into lane closure or roadblock vehicle ownership.

## Multiplayer and Netcode Boundary

- Eligibility, slot reservation, closure state, deployment, breach, and cleanup are server-only.
- Barricade cars use existing `VehicleState`, collision, damage, hijack, replication, AOI,
  and interaction-island admission.
- Clients do not predict deployment or route closure authority.
- F3 snapshots are observational: panel counts, red closed lane edges, and phase-colored
  slot glyphs do not affect simulation.
- G3c changes no prediction, reconciliation, interpolation, rewind, rollout,
  interaction-island, or shared movement/contact implementation.

## Acceptance

- Authored slots and poses validate at startup.
- Overlapping closure owners retain edges until the final owner releases.
- Spawn, virtual advance, and route planning reject closed edges.
- Deployment waits for visible players, active routed traffic, and physical pose occupancy.
- Hijacked cars survive ownership release; unseen owned cars retire and reopen the route.
- Focused, full regression, permanent netcode, strict soak, build, and live Three.js QA pass.

# Police Stinger and Tyre-State Research

Status: G3d implementation contract

## Scope and Legal Boundary

This milestone uses pinned reverse-engineered sources only as educational behavior
references. NOCK0 does not copy source, symbols, assets, native data structures, or tuning
tables. Its implementation is original TypeScript designed for authoritative multiplayer,
deterministic replay, Colyseus AOI replication, and the authored Industrial District.

- reVC commit [`b9eeb33efcd04a5b7a423921609baef11bf4719a`](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a)
- re3 commit [`3233ffe1c4b99e8efb4c41c6794b4fce880cf503`](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)

## Production Behaviors Preserved

### A stinger is an owned lifecycle, not a roadblock decoration

reVC gives a strip an owning police pedestrian, a finite global segment budget, animation
gates, deployment and retraction phases, contact state, and explicit cleanup. A police
officer admits the deployment only when a pursued vehicle is nearby and approaching.

- [reVC ownership and deployment admission](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/objects/Stinger.cpp#L35-L118)
- [reVC timed deployment and teardown](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/objects/Stinger.cpp#L186-L258)

NOCK0 therefore keeps `PoliceRoadblockController` responsible for barricade vehicles and
adds a separate `PoliceStingerController` for the strip, its officer, an overlapping lane
closure, segment timing, wheel contacts, typed events, and teardown. It consumes immutable
roadblock deployment facts instead of adding more behavior to `DistrictRoom`.

### Contact is wheel-specific and swept

The reference checks individual automobile wheels against active strip segments and mutates
only the wheels that contact the strip:

- [reVC per-wheel contact](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/objects/Stinger.cpp#L121-L184)
- [reVC wheel/component state](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/vehicles/DamageManager.cpp)

NOCK0 uses twelve deterministic segment positions and four wheel positions derived from the
catalog collision box. Contact is swept from the previous to current wheel pose, so a fast
vehicle cannot tunnel across the strip between server ticks. A four-bit mask preserves exact
front-left, rear-left, front-right, and rear-right identity.

### Burst tyres change handling

The reference games feed burst-wheel state into tyre forces and presentation rather than
treating it as cosmetic damage. NOCK0's original handling policy applies bounded speed,
acceleration, braking, coasting, and steering-rate loss by burst count. Left/right imbalance
adds a deterministic steering pull. The same modifier function is consumed by player
authority, ambient/police driving, local saved-input prediction, and interaction replay.

## NOCK0 Lifecycle

1. A deployed G3c roadblock exposes an authored stinger pose and officer pose.
2. G3d acquires the same blocked edges under its own owner ID before creating actors.
3. One owned police pedestrian prepares for 390 ms.
4. Twelve replicated segments expand over 2.5 seconds.
5. After vehicle motion, swept wheel contact adds authoritative tyre bits and emits one
   `vehicle.tyres-burst` event for each newly damaged wheel set.
6. Wanted loss, roadblock retirement, or officer death starts a 2.5-second retraction.
7. The strip releases its officer and closure only after every segment is removed.

The district has a maximum of two active strips, matching the authored roadblock pressure
without creating an unbounded actor or collision budget.

## Multiplayer and Prediction Boundary

- Eligibility, officer ownership, segment phase, strip contact, tyre mutation, events, and
  teardown are server-authoritative and never replay side effects.
- `StingerState` is an append-only replicated district collection with ordinary street AOI
  hysteresis. Clients render only replicated segments.
- `VehicleState.tyreDamageMask` is an append-only vehicle schema field.
- Interaction protocol version 5 includes the tyre mask in immutable vehicle baselines and
  validates the range `0..15`.
- On authoritative correction, saved-input prediction and whole-island replay restore the
  new mask and replay pending movement with the same mechanical modifiers as the server.
- The client does not predict an unconfirmed strip hit. Latency may delay the initial tyre
  response until authority arrives, but reconciliation cannot retain pre-hit handling or
  emit duplicate damage/events. Immediate provisional contact is a later presentation slice.
- Stinger actors do not consume the interaction-island weighted-body budget because they
  are static trigger geometry, not dynamic impulse bodies.

## Observability

F3 reports strip count, prepare/deploy/deployed/retire phases, active segments, contacts,
last contacted vehicle, and burst mask. Its world overlay draws exact segment centers from
the shared contact function. The normal Three renderer uses one disposable AOI entity whose
painted twelve-segment strip expands and retracts from replicated state.

## Acceptance

- Authored strip/officer poses validate against the district map.
- Twelve segment positions and four tyre identities are stable and deterministic.
- Swept full and partial crossings damage only contacted wheels.
- Roadblock and stinger closure claims overlap without reopening an active lane early.
- Officer death and roadblock retirement retract and clean up owned state.
- Repair/reset clears tyre state.
- Browser/server movement parity, permanent netcode, strict impairment soak, full
  regression, optimized build, and live desktop/mobile Three QA pass.

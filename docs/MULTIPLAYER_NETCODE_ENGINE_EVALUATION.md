# Multiplayer Netcode Engine Evaluation

## Decision

NOCK0 should retain Colyseus and implement a small Colyseus-native prediction layer. It should not migrate to Lance, Netick, SuperTuxKart, or Ring Racers.

The target model is:

- one authoritative fixed-step district simulation on the server;
- one shared deterministic TypeScript vehicle step used by server and browser;
- saved local inputs and authoritative input acknowledgements;
- timestamped interpolation for remote actors outside collision range;
- bounded whole-island rewind and resimulation for vehicles that can collide with the locally controlled vehicle;
- render-only correction smoothing after physics reconciliation;
- server-owned damage, occupancy, pickups, projectiles, economy, and mission outcomes.

This keeps the production infrastructure, area-of-interest replication, state views, persistence boundaries, and game systems already built around Colyseus. It ports the useful techniques from the reviewed projects without importing their transport, engine, licensing, or maintenance constraints.

The generalized application of these patterns to on-foot players, pedestrians,
combat, world objects, population LOD, and persistent interactions is specified in
[`WORLD_INTERACTION_NETCODE_ARCHITECTURE.md`](WORLD_INTERACTION_NETCODE_ARCHITECTURE.md).

## Repositories Reviewed

| Project | What it demonstrates | License boundary | Decision |
|---|---|---|---|
| [Lance](https://github.com/lance-gg/lance) | Generic JavaScript input replay, state reconciliation, visual bending, shadow objects | Apache-2.0 | Port concepts only |
| [Netick Rocket Cars](https://github.com/NetickNetworking/NetickRocketCars) | Full interacting-world vehicle prediction and remote input hold/decay | Sample gameplay is MIT; Netick rollback engine is closed | Port sample patterns; reimplement engine layer |
| [SuperTuxKart](https://github.com/supertuxkart/stk-code) | Authoritative snapshots, client world rewind, event history, projectile reconciliation | GPL-3.0-or-later | Study behavior only; do not copy or translate code |
| [Ring Racers](https://github.com/KartKrewDev/RingRacers) | Deterministic command lockstep, input validation, state checksums | GPL-2.0-or-later | Port selected ideas independently; reject full lockstep |

## Lance

### What it does

Lance is a Node.js multiplayer runtime with its own client, server, Socket.IO transport, world model, serializer, sync strategies, and optional physics wrappers. Its extrapolation strategy:

1. applies input immediately on the client;
2. records movement inputs by client step;
3. accepts an authoritative server state for an older step;
4. resets the client world to that step;
5. replays movement inputs to the present;
6. stores the resulting error;
7. gradually bends visual objects toward the corrected state.

The implementation is in [`ExtrapolateStrategy.ts`](https://github.com/lance-gg/lance/blob/fd9bc5dce93f59684acc0c862a3a7849b993f65a/src/syncStrategies/ExtrapolateStrategy.ts#L44-L207), and the official [extrapolation documentation](https://lance-gg.github.io/docs_out/tutorial-guide_syncextrapolation.html) describes the same reset, replay, and bending sequence.

Lance also models client-created shadow objects so a local projectile can appear before the server confirms its authoritative entity. Its current implementation reserves a numeric ID range and correlates through an application input ID in [`GameEngine.ts`](https://github.com/lance-gg/lance/blob/fd9bc5dce93f59684acc0c862a3a7849b993f65a/src/GameEngine.ts#L148-L167).

### What is useful to NOCK0

- Input history plus authoritative acknowledgement.
- Re-enacting only deterministic simulation, not presentation side effects.
- Separate correction factors for locally controlled and remote objects.
- Render-transform bending after simulation state has already been corrected.
- Predicted-spawn correlation for bullets, rockets, grenades, and effects.

### Why we should not use Lance directly

- Lance would replace Colyseus rather than complement it. Its sync strategy depends on Lance's `ClientEngine`, `ServerEngine`, `GameWorld`, object constructors, serializer, Socket.IO protocol, and shared `GameEngine.step()` lifecycle.
- Its rooms are replication filters inside one shared process and world, not isolated simulation units like Colyseus rooms. The [official FAQ](https://lance-gg.github.io/docs_out/tutorial-introduction_faq.html) says large-world partitioning and persistent state are not implemented.
- Current source is stale for a foundational dependency. The latest source commit is [`fd9bc5d` from May 11, 2024](https://github.com/lance-gg/lance/commit/fd9bc5dce93f59684acc0c862a3a7849b993f65a); releases and CI lag further behind.
- The current tree contains correctness risks in serializer construction, room event routing, dynamic-object synchronization, and bending helpers. Adopting it would require owning a fork before game-specific work could continue.
- Its Cannon and P2 integrations use legacy packages and do not provide the deterministic, bounded 2D collision replay NOCK0 needs.
- Its Three.js renderer is not a useful integration layer for the current client.

### Lance verdict

Port the architecture, not the runtime. Apache-2.0 permits reuse with its notice obligations, but an independent, smaller implementation is safer and fits the existing code better.

## Netick Rocket Cars

### What it does

Rocket Cars is the closest reference for responsive collisions between multiple player-driven vehicles. The sample runs a 40 Hz authoritative fixed-step simulation and configures cars and the ball for prediction by every client. Input is sampled into a compact command and the same car controller runs on the server and predicted clients:

- [`Input.cs`](https://github.com/NetickNetworking/NetickRocketCars/blob/907ec50519d61920eefbbd34897aecf2e81e5dc1/Assets/Rocket%20Cars/Scripts/Player/Input.cs#L8-L16)
- [`GameMode.cs`](https://github.com/NetickNetworking/NetickRocketCars/blob/907ec50519d61920eefbbd34897aecf2e81e5dc1/Assets/Rocket%20Cars/Scripts/Game/GameMode.cs#L46-L61)
- [`CarController.NetworkFixedUpdate`](https://github.com/NetickNetworking/NetickRocketCars/blob/907ec50519d61920eefbbd34897aecf2e81e5dc1/Assets/Rocket%20Cars/Scripts/Player/Car/CarController.cs#L157-L186)

Remote cars cannot know future input. They continue the last authoritative input and decay it as predicted time gets farther ahead. The sample also damps proxy velocity and longitudinal force to bound divergence:

- [`CarController.cs`](https://github.com/NetickNetworking/NetickRocketCars/blob/907ec50519d61920eefbbd34897aecf2e81e5dc1/Assets/Rocket%20Cars/Scripts/Player/Car/CarController.cs#L422-L445)
- [`Car.prefab`](https://github.com/NetickNetworking/NetickRocketCars/blob/907ec50519d61920eefbbd34897aecf2e81e5dc1/Assets/Rocket%20Cars/Prefabs/Network%20Prefabs/Car.prefab#L746-L756)

The important collision property is not a special network collision RPC. All collidable cars and the ball are restored to one authoritative tick and resimulated together. Their physics contacts therefore occur on the same predicted timeline. Audio, camera shake, and other one-shot effects are suppressed during resimulation.

### What is useful to NOCK0

- Predict all objects inside a small interacting collision set, not only the locally controlled car.
- Replicate each remote driver's last applied input.
- Hold remote input briefly, then decay it over a bounded horizon.
- Restore the entire interacting set to one authoritative tick before replay.
- Keep corrected simulation transforms exact and smooth separate visual transforms.
- Guard sound, particles, camera shake, damage UI, and other one-shot effects during replay.
- Keep bounded input and world-state rings. Netick's 64 ticks at 40 Hz represent 1.6 seconds of history.

### What cannot be reused

The sample gameplay is MIT, but Netick's snapshot storage, input history, rigidbody restoration, rollback scheduler, and correction engine are distributed in closed DLLs. The sample is an architectural reference, not a TypeScript rollback package. Its Unity PhysX simulation is also too expensive and nondeterministic for broad open-world browser replay.

### Netick verdict

Port the full-world collision principle into a bounded prediction island. Do not try to adopt Netick in the browser, and do not reproduce its proprietary internals from binaries.

## SuperTuxKart

### What it does

SuperTuxKart uses an authoritative, input-driven server. Clients send tick-stamped control changes and immediately add their own controls to local history. The server verifies kart ownership, relays accepted input, and periodically sends authoritative world states:

- [`game_protocol.cpp`](https://github.com/supertuxkart/stk-code/blob/4c7638f0a06beafe0586a404eb0267be62e17bc8/src/network/protocols/game_protocol.cpp#L145-L363)
- [`rewind_manager.hpp`](https://github.com/supertuxkart/stk-code/blob/4c7638f0a06beafe0586a404eb0267be62e17bc8/src/network/rewind_manager.hpp#L39-L82)

On a correction, the client restores a confirmed world state, restores client-local state, replays events and fixed physics steps, and computes graphical correction errors:

- [`rewind_queue.cpp`](https://github.com/supertuxkart/stk-code/blob/4c7638f0a06beafe0586a404eb0267be62e17bc8/src/network/rewind_queue.cpp#L201-L289)
- [`rewind_manager.cpp`](https://github.com/supertuxkart/stk-code/blob/4c7638f0a06beafe0586a404eb0267be62e17bc8/src/network/rewind_manager.cpp#L294-L407)
- [`smooth_network_body.cpp`](https://github.com/supertuxkart/stk-code/blob/4c7638f0a06beafe0586a404eb0267be62e17bc8/src/network/smooth_network_body.cpp#L53-L185)

Authoritative kart snapshots include transform, linear and angular velocity, bounce state, and collision impulse. Projectiles are rewindable entities with stable IDs; predicted projectiles absent from authoritative state are removed. Item pickups are provisional until confirmed.

The server does not rewind physical collisions. Late controls are applied at the current server tick. The server uses an initial timing offset so inputs are more likely to arrive before their intended simulation step.

### What is useful to NOCK0

- Separate state history, input/event history, and visual smoothing.
- Stable predicted entity IDs and authoritative removal of rejected projectiles.
- Provisional item pickup and projectile presentation without provisional damage authority.
- Include collision aftermath in authoritative vehicle snapshots, not only position.
- Consider a small server input-delay budget for highly interactive race/event modes.

### Licensing boundary

SuperTuxKart is GPL-3.0-or-later. NOCK0 can study its architecture, but copying, translating, or adapting implementation into this MIT project would create a licensing conflict. The implementation here must be independent.

### SuperTuxKart verdict

Adopt the event-history and provisional-entity concepts independently. Do not copy code and do not import its Bullet-based world rewind.

## Ring Racers

### What it does

Ring Racers uses deterministic command lockstep rather than general client rollback. A compact command contains movement, buttons, predicted angle, and latency; the server assigns commands to future ticks, repeats the previous command when input is missing, and broadcasts every player's commands:

- [`d_ticcmd.h`](https://github.com/KartKrewDev/RingRacers/blob/d8b4e8a39ac1f032e8a9fd6c487659128f280b77/src/d_ticcmd.h#L52-L89)
- [`d_clisrv.c`](https://github.com/KartKrewDev/RingRacers/blob/d8b4e8a39ac1f032e8a9fd6c487659128f280b77/src/d_clisrv.c#L6614-L6813)

Its world uses 16.16 fixed-point arithmetic. It checks synchronized state with a compact checksum and repairs major desync by loading a complete server save rather than rewinding. It clamps illegal command values and can kick invalid senders.

### What is useful to NOCK0

- Compact command bitsets rather than many separate action messages.
- Explicit missing-input policy.
- Deterministic random streams for replayed gameplay rules.
- Periodic canonical state hashes as diagnostics.
- Strong bounds and ownership checks on every command.

### What should be rejected

Full lockstep requires all simulation inputs before a tick can advance or requires deliberate input delay. It also requires deterministic whole-world physics, AI, projectiles, random behavior, and lifecycle. That is a poor fit for a persistent browser city with variable population and many unrelated systems.

Ring Racers is GPL-2.0-or-later, so its implementation must not be copied or translated into NOCK0.

## Current NOCK0 State

NOCK0 already has several correct foundations:

- Colyseus `DistrictRoom` runs a 30 Hz authoritative simulation and publishes schema patches every 50 ms.
- Vehicle inputs carry monotonic sequence numbers.
- The server validates vehicle ownership and bounds input values.
- `SavedVehiclePrediction` keeps bounded local input history, compares a matching acknowledged historical state, restores authority, and replays unacknowledged input.
- Phaser and Three use a separate decaying render offset after reconciliation.
- The browser and server share catalog dimensions and swept oriented static-world occupancy.
- The server resolves dynamic vehicle contacts with oriented boxes, stable pair deduplication, mass-aware separation, impulse, damage, and damage-zone classification.
- F3 can show predicted and authoritative transforms separately.

The current problems are architectural, not threshold tuning:

1. The browser predicts only the local car against the static map.
2. Dynamic vehicle contacts exist only on the server.
3. Nearby cars are rendered from current schema targets, not restored into a timestamped collision history.
4. The local car and contacted remote car therefore occupy different timelines.
5. The server duplicates acceleration, steering, and coast logic instead of calling the same pure step as the browser.
6. The dynamic collision solver is not part of saved-input replay.
7. Authoritative debug bodies correctly lag predicted presentation by network delay, but collision feedback also waits for that authoritative body.

The visible trailing authority box is therefore expected. The defect is that it is currently the only body capable of colliding with another vehicle.

## Recommended Prediction Island

Predicting every pedestrian, traffic car, projectile, and mission object in a district would be too expensive and would amplify divergence. Predicting only the local car produces mixed-timeline collisions. The middle ground is a bounded prediction island.

### Membership

The client prediction island contains:

- the locally controlled car;
- player-driven cars within a collision horizon;
- traffic or police cars whose swept path can intersect the local car during the history horizon;
- directly contacted vehicles retained for a short hysteresis window;
- locally predicted projectiles only when their gameplay family requires it.

Membership must be ID-stable and bounded, initially to the local vehicle plus the nearest 7 collision-relevant vehicles. Distant vehicles remain snapshot-interpolated and cannot enter the island without an authoritative baseline tick.

### Authoritative snapshot contract

Each relevant vehicle snapshot needs:

```ts
interface VehicleSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  lastInputX: number;
  lastInputY: number;
  lastInputSequence: number;
  lastInputServerTick: number;
  collisionRevision: number;
  destroyed: boolean;
}

interface PredictionSnapshot {
  serverTick: number;
  serverTimeMs: number;
  acknowledgedLocalInputSequence: number;
  vehicles: VehicleSnapshot[];
}
```

The state does not need to expose private AI plans. It needs the physical state and last applied driving command required for a short bounded prediction.

### Client correction sequence

1. Receive and materialize one immutable authoritative prediction snapshot.
2. Restore all prediction-island vehicles to the same `serverTick`.
3. Remove acknowledged local inputs.
4. Replay each fixed tick to the current predicted tick.
5. Apply exact saved local input for the owned car.
6. Hold the latest authoritative remote input briefly, then decay it toward neutral.
7. Step every island vehicle through the same shared movement and world-collision code.
8. Resolve dynamic contacts in stable ID-pair order.
9. Suppress one-shot audiovisual and gameplay side effects during replay.
10. Replace physics poses immediately and decay only the old-to-new render offset.

### Server rules

- The server never rewinds physical vehicle collisions.
- The server remains the only authority for damage, occupant injury, destruction, hijacking, pickups, mission state, and economy.
- The server accepts input intent, never client transforms or collision claims.
- Late input uses an explicit policy: discard stale edge actions, hold bounded analog movement, and record lateness telemetry.
- Hitscan weapons may use bounded historical hitbox queries, but vehicles, explosions, and physical projectiles resolve at server time.

## Code Reuse Matrix

| Component | Use as dependency | Copy/translate | Independently implement |
|---|---:|---:|---:|
| Lance runtime | No | No | Its input replay and visual bending concepts |
| Lance serializer/transport/rooms | No | No | Keep Colyseus equivalents |
| Rocket Cars gameplay code | No | Only with MIT notice and only if a direct translation is justified | Prefer a clean TypeScript model informed by it |
| Netick prediction engine | No browser-compatible package | No; implementation is closed | Snapshot ring, input ring, rollback scheduler |
| SuperTuxKart | No | No; GPL boundary | Event history, provisional items/projectiles, state separation |
| Ring Racers | No | No; GPL boundary | Command packing, state hashes, missing-input policy |

## Implementation Plan

### Phase 1: Eliminate simulation drift

1. Move acceleration, braking, steering, speed limits, integration, and static-world collision into one shared pure `stepVehicle` function.
2. Make both `VehicleSimulationController` and `SavedVehiclePrediction` call it.
3. Add deterministic state quantization at tick boundaries and stable entity ordering.
4. Add server/client parity tests that replay the same 500-command trace and require identical states.

### Phase 2: Correct remote timing

1. Add timestamped snapshot buffers for remote vehicles.
2. Render remote vehicles at an adaptive interpolation delay derived from observed patch jitter.
3. Freeze or short-extrapolate after the buffer horizon; never extrapolate indefinitely.
4. Expose snapshot age and extrapolated milliseconds in F3.

### Phase 3: Prediction island

1. Replicate last applied input and authoritative tick for collision-relevant nearby vehicles.
2. Add bounded prediction-island selection with hysteresis.
3. Save immutable island states alongside local input history.
4. Replay the whole island with stable OBB pair ordering.
5. Add last-input hold and time-based decay for remote cars.
6. Keep damage and destruction provisional in presentation only until the server confirms them.

### Phase 4: Predicted gameplay entities

1. Give locally spawned projectiles a `clientSpawnId`.
2. Match them to authoritative server entities or remove rejected shadows.
3. Make item and service interactions visually provisional but economically authoritative.
4. Add replay-side-effect guards for audio, particles, notices, and camera shake.

### Phase 5: Production validation

Automate scenarios at 0, 50, 100, 150, 250, and 350 ms RTT with jitter, message duplication, burst delay, render stalls, and server tick overruns. Record:

- input-to-motion latency;
- prediction position, angle, and speed error percentiles;
- resimulations and ticks replayed per second;
- hard correction count;
- dynamic contact disagreement count;
- prediction-island size;
- remote extrapolation time;
- client and server simulation cost;
- event replay suppression failures.

The first production gate is two player-driven cars colliding repeatedly at 150 ms RTT without delayed contact, visible hard snaps, duplicate damage, or divergent occupant state.

## Final Recommendation

Do not install Lance or replace Colyseus. Lance solves a generic version of a problem we have already partially solved, but adopting it would discard stronger infrastructure and add stale engine code.

Use Lance as the conceptual baseline for input replay and render bending, Rocket Cars as the reference for replaying all collidable vehicles on one timeline, SuperTuxKart as the reference for event/state history and provisional entities, and Ring Racers as the reference for compact validated commands and desync diagnostics.

The next implementation milestone should be Phase 1, followed by timestamped remote vehicle buffers. Dynamic-contact prediction should begin only after the server and client run the exact same pure vehicle step.

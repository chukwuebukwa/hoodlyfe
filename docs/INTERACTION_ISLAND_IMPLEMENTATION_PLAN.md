# Interaction-Island Netcode Implementation Plan

## Objective

Build a bounded, per-client interaction-island system around the existing
server-authoritative Colyseus simulation. Ordinary remote actors remain on timestamped
snapshot interpolation. Only actors that can physically affect the locally controlled
actor during a short collision horizon are promoted into shared fixed-tick replay.

The island is not a server partition, replication AOI, or client authority boundary.
Damage, death, occupancy, inventory, missions, economy, and persistence remain server
outcomes.

## Non-Negotiable Boundaries

- Shared infrastructure owns tick alignment, history, selection, restore/replay,
  correction, and diagnostics.
- Family kernels separately own vehicle, on-foot, dynamic-contact, and projectile
  stepping.
- Remote pedestrian AI is never executed by the browser. A promoted proxy may only
  continue bounded last-known physical intent.
- Replay suppresses gameplay events and one-shot presentation side effects.
- Attachments such as weapons, labels, passengers, lights, and debug colliders compose
  from one predicted actor transform.
- Every island member restores to the same authoritative tick.

## Initial Policy

| Policy | Initial value |
|---|---:|
| Fixed simulation rate | 30 Hz |
| Island history | 24 ticks / 800 ms |
| Public combat rewind cap | 200 ms |
| Desktop island budget | 32 weighted points |
| Mobile island budget | 20 weighted points |
| Vehicle cost | 4 points |
| Humanoid cost | 1 point |
| Movable prop cost | 2 points |
| Contact retention | 6 ticks |
| Remote intent hold | 2 ticks |
| Remote intent decay | 4 ticks |

Current contacts outrank future contacts. Remaining candidates sort by time-to-contact,
gameplay priority, and stable entity ID. Selection uses enter/exit hysteresis. Overflow
actors remain server-authoritative obstacles and increment diagnostics.

## Milestones

### M0: Baseline Diagnostics - Complete

- Replicate `serverTick` beside `serverTimeMs`.
- Record current, mean, and p95 prediction correction error.
- Count corrections, resimulations, hard snaps, pending moves, and acknowledgements.
- Add replay duration, replayed ticks, island size, overflow, snapshot age, extrapolation,
  bandwidth, and per-system simulation CPU as those systems are introduced.
- Build repeatable 0/75/150/250 ms RTT, jitter, and packet-loss test profiles.

Gate: the same scripted drive produces comparable diagnostics on local and impaired
connections.

### M1: Tick And Snapshot Contracts - Complete

- Define validated sequenced commands with client prediction tick.
- Define immutable interaction snapshots stamped with one `serverTick`.
- Include lifecycle and static-collision revisions.
- Include physical state and last server-applied intent, not private AI plans.
- Reject incomplete, stale, non-finite, or revision-incompatible baselines.

Gate: snapshot and command validation tests fail closed.

### M2: Shared Vehicle Kernel - Complete

- One shared pure kernel owns acceleration, braking, steering, mechanical speed limits,
  integration, and swept static-world collision.
- The server, Phaser predictor, and Three predictor call the same kernel.
- Damage, events, occupant synchronization, and dynamic contacts remain server owners.
- Long parity traces cover every vehicle model and damaged/on-fire modifiers.

Gate: full tests and production build pass with no deterministic trace divergence.

### M3: Shared On-Foot Kernel - Complete

- Replace presentation-only movement replay with fixed-tick saved-input state history.
- Share normalization, movement scaling, interior/static collision, and action movement
  constraints between server and browser.
- Keep ordinary player separation soft; promote hard contacts only for explicit physical
  interactions.

Gate: local walking remains immediate without walking through walls before correction.

Implemented with a 30 Hz shared movement kernel, sequenced batched input, server-applied
acknowledgements, 96-move saved history, authoritative rewind/replay, and hard correction
for space transitions or errors above 120 px. Phaser and Three render the local body,
weapon, label, and debug collider from one predicted transform. Deterministic wall and
interior collision are shared between browser and server.

### M4: Remote Timelines - Complete

- Generalize timestamped snapshot buffers for players, vehicles, and NPCs.
- Sample against estimated server time minus adaptive interpolation delay.
- Bound extrapolation and report snapshot age and buffer underruns.

Gate: remote movement is smooth under jitter without arrival-time interpolation.

Implemented with one timestamped timeline primitive shared by Phaser and Three for
remote players, NPCs, and vehicles. Rendering samples estimated server time minus an
adaptive 75-250 ms delay derived from patch cadence, jitter, and RTT variation. Family
configuration owns teleport thresholds and extrapolation speed limits; all families cap
extrapolation at 100 ms and reset history across discontinuities. The local driver and
local passenger vehicle paths remain responsive and bypass the remote timeline.

Network diagnostics now report p95 snapshot age, buffer underrun percentage, and
extrapolation percentage. Deterministic local through intercontinental impairment tests
bound maximum error to 34.02 px, buffer underruns to 1.7%, and retained history to 32
snapshots per actor.

### M5: Interaction Snapshot Projection - Complete

- Add a server projector beside, not inside, replication AOI ownership.
- Project complete candidate baselines from one tick for each client.
- Pin required candidate state long enough to admit or reject promotion safely.

Gate: an entity never enters replay without a complete same-tick baseline.

Implemented with a dedicated server projector that captures players, pedestrians,
vehicles, rockets, and thrown projectiles once after authoritative simulation and event
processing. Per-client projection happens separately during the patch phase, keeps the
controlled physical root first, excludes occupied humanoid bodies and mixed spaces, and
selects only entities present in that immutable captured frame. Known applied on-foot
and driver intents are included; private pedestrian and traffic plans are not.

The broad-phase candidate source is independent of replication AOI ownership and uses a
temporary deterministic 768 px admission radius. It filters stale spatial records,
occupied players, cross-space actors, duplicate identities, and distant projectiles.
M6 replaces distance ordering with bounded time-to-contact scoring, weighted budgets,
hysteresis, and contact closure.

Validated baselines carry collider and lifecycle revisions, static-world revision,
acknowledged local input, confirmed event tick, derived/exact velocity, and one
space/layer. Server and client retain a 24-tick window. The client inbox validates every
message, permits a bounded three-tick lead for 30 Hz simulation versus 20 Hz patch
ordering, replaces duplicate ticks deterministically, reports rejection reasons, and
owns listener teardown for both renderers.

### M6: Generic Island Selection

- Query swept candidates from the spatial index using RTT, interpolation delay, jitter,
  speed, collider reach, and current contact state.
- Apply weighted budgets, hysteresis, stable scoring, and one-hop contact closure.
- Treat overflow as a measurable conservative fallback.

Gate: membership is stable and bounded in dense traffic.

### M7: Whole-Island Replay

- Store immutable island state beside local command history.
- Restore all members to one tick and replay in stable ordered pairs.
- Hold then decay remote physical intent.
- Suppress damage, events, audio, particles, and lifecycle mutation during replay.
- Apply corrections to simulation immediately and decay render-only offsets.

Gate: replaying the same baseline and commands produces the same state and no duplicate
side effects.

### M8-M10: Interaction Families

- M8: vehicle-to-vehicle dynamic contacts as the first vertical slice.
- M9: humanoid impacts, vehicle entry/exit, passenger constraints, and attachments.
- M10: predicted projectile correlation plus server historical hit queries.

Bullets initially predict recoil/tracer presentation while the server performs bounded
rewound hit validation. Grenades and rockets may use deterministic predicted spawns.

### M11: Production Rollout

- Gate each stage behind independent feature flags.
- Run multi-client latency, jitter, loss, dense traffic, stream-in/out, destruction,
  respawn, and occupancy-transition soaks.
- Roll out shared kernels first, remote timelines second, and interaction islands last.

Initial targets at 150 ms RTT, 30 ms jitter, and 1% loss:

- local input responds on the next rendered frame;
- predicted body and active local collider never separate;
- island replay stays below 2 ms p95 on desktop;
- island membership never exceeds its weighted budget;
- no duplicate gameplay or presentation side effects;
- every client converges on the authoritative outcome.

## Intended Ownership

```text
shared/simulation/       pure family kernels and simulation contracts
shared/protocol/         validated commands and immutable snapshot messages
server/game/networking/  admission, snapshot projection, history, lag queries
src/game/network/        clock synchronization and remote snapshot buffers
src/game/prediction/     island selection, history, replay, reconciliation
src/game/rendering/      actor transforms and correction smoothing
```

`DistrictRoom` composes these owners and passes fixed-tick frames and typed events. It
must not absorb their policies.

## Supporting Research

- [World interaction netcode architecture](WORLD_INTERACTION_NETCODE_ARCHITECTURE.md)
- [Multiplayer netcode engine evaluation](MULTIPLAYER_NETCODE_ENGINE_EVALUATION.md)
- [Networked vehicle physics research](NETWORKED_VEHICLE_PHYSICS_RESEARCH.md)
- [Colyseus-native prediction decision](decisions/0005-colyseus-native-prediction.md)

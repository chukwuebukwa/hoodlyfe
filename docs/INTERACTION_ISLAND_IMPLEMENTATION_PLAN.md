# Interaction-Island Netcode Implementation Plan

> Partially restored on 2026-08-20. Local grounded on-foot prediction and reconciliation
> are active behind a rollout flag. The multi-body interaction-island selection, snapshot,
> and replay stages below remain design work and are not deployed runtime behavior.

## Objective

Build a bounded, per-client interaction-island system around the existing
server-authoritative Colyseus simulation. Ordinary remote actors remain on timestamped
snapshot interpolation. Only actors that can physically affect the locally controlled
actor during a short collision horizon are promoted into shared fixed-tick replay.

The island is not a server partition, replication AOI, or client authority boundary.
Damage, death, occupancy, inventory, missions, economy, and persistence remain server
outcomes.

## Plain-English Technical Summary

This project is replacing the situation where the browser displays one position while
the server simulates another with proper prediction and reconciliation.

The browser and server share the same movement functions for walking, driving, and
static-world collision. When a player presses a movement key, the browser applies that
input immediately, gives it a sequence number, saves it, and sends it to the server. The
server processes the input and returns an authoritative state plus the last sequence it
accepted. If the two simulations disagree, the browser restores the confirmed state and
replays every input that the server has not acknowledged yet.

Remote players, NPCs, and ordinary vehicles are handled differently. Their timestamped
snapshots are buffered and rendered at a small controlled delay, which turns irregular
packet arrival into smooth interpolation. Extrapolation is short and bounded so a
missing packet cannot make an actor drift indefinitely.

Predicting only the local car is insufficient when it collides with another moving car.
The other car may be rendered from an older buffered snapshot, leaving the two cars on
different physical timelines. An interaction island solves this by temporarily
promoting only the nearby bodies that can physically affect the locally controlled body.
Selection considers current contact, predicted time to contact, velocity, collider size,
gameplay priority, and previous membership while enforcing a strict processing budget.

The current on-foot predictor retains 24 immutable fixed-tick frames, approximately 400
ms at 60 Hz. A future island implementation must choose its own measured history budget. When an
authoritative correction arrives, every island member is restored to the same server
tick. The browser then replays the player's exact saved commands, briefly continues the
last server-applied controls for relevant remote bodies, steps shared collision code,
and resolves each pair once in stable ID order. This is actual resimulation, not merely
moving a sprite toward a server coordinate.

Canonical predicted physics is corrected immediately. A temporary render-only offset
can decay over several frames so the correction is not shown as a harsh teleport. The
visible actor, weapon, passengers, lights, labels, and debug presentation must all derive
from that same final predicted transform.

Replay is allowed to calculate temporary position, velocity, and collision response, but
it cannot independently create damage, explosions, crime, money changes, mission
progress, sounds, particles, or database writes. Those lasting outcomes remain server
authoritative and replay suppresses them to prevent duplication.

For vehicle collisions, the shared physical kernel calculates oriented-box overlap,
mass-weighted separation, relative closing speed, impulse, transferred momentum, and
impact direction. The browser uses the physical result for immediate responsiveness;
the server uses the same calculation and remains the sole authority for damage,
destruction, occupants, rewards, and other gameplay consequences.

The intended result is immediate local controls, smooth remote movement, timely nearby
collisions, and small corrections under latency without trusting clients with persistent
game state or simulating the entire district in every browser.

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
| Fixed simulation rate | 60 Hz |
| Local on-foot history | 24 ticks / 400 ms |
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

Restored with a 60 Hz shared movement kernel, sequenced batched input, server-applied
acknowledgements, 24-move saved history, authoritative rewind/replay, and hard correction
for unsupported state transitions or errors above 120 px. Three renders the local body,
weapon, label, and camera from one predicted transform. Authored surface occupancy and
explicit surface transitions are shared between browser and server. Interiors, airborne
movement, vehicles, and unsupported actions intentionally fall back to authority.

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

### M6: Generic Island Selection - Complete

- Query swept candidates from the spatial index using RTT, interpolation delay, jitter,
  speed, collider reach, and current contact state.
- Apply weighted budgets, hysteresis, stable scoring, and one-hop contact closure.
- Treat overflow as a measurable conservative fallback.

Gate: membership is stable and bounded in dense traffic.

Implemented with shared exact overlap tests for circles and oriented boxes, conservative
swept-circle time-to-contact admission, and a renderer-independent stateful selector.
The client horizon is derived from half RTT, interpolation delay, and doubled jitter,
bounded to 100-500 ms; exit admission extends to 650 ms. Current contacts rank first,
then six-tick retained contacts, then future contacts by adjusted time to contact,
validated gameplay priority, and stable identity. One-hop contact closure includes a
body touching a direct member without recursively absorbing an entire traffic queue.

Desktop islands have a 32-point budget and mobile islands have 20 points. Vehicles cost
4, movable props cost 2, and humanoids/projectiles cost 1; the controlled root counts
against the same hard cap. Destroyed vehicles remain physical obstacles. Collider and
lifecycle revision changes reset hysteresis, and every omitted eligible body is exposed
as deterministic conservative overflow rather than silently disappearing.

The interaction wire contract is now version 2 and carries a validated physical
priority only: player-controlled, mission-critical, or ambient. Occupied remote vehicles
therefore retain player priority without publishing private traffic or mission logic.
The server ranks all same-tick candidates before its 64-entity transport cap so nearby
stationary ambience cannot displace a slightly farther imminent contact. Both renderers
compose the same controller and publish island size, weighted budget, overflow, horizon,
and snapshot age through the existing F3 network diagnostics.

Dense deterministic tests hold stable membership for 120 ticks under changing RTT,
jitter, and reversed input order. The dedicated netcode gate passes 55 tests, the
complete repository gate passes 344 tests, the production build passes, and the real
two-client Colyseus scenario passes with protocol-v2 snapshots. M6 selects and measures
islands only; dynamic replay begins in M7.

### M7: Whole-Island Replay - Complete

- Store immutable island state beside local command history.
- Restore all members to one tick and replay in stable ordered pairs.
- Hold then decay remote physical intent.
- Suppress damage, events, audio, particles, and lifecycle mutation during replay.
- Apply corrections to simulation immediately and decay render-only offsets.

Gate: replaying the same baseline and commands produces the same state and no duplicate
side effects.

The client now retains 24 immutable same-tick island frames and resets that history on
controlled-root or static-world revision changes. A renderer-independent replay owner
restores every selected body from one baseline, advances fixed 30 Hz body steps in
stable identity order, and resolves each unordered dynamic pair exactly once in stable
order. Local saved commands take precedence. Remote physical intent is held for two
ticks and then decays linearly to neutral over four ticks.

Replay runs behind an explicit side-effect gate. Pure state transitions are allowed,
while gameplay, durable transaction, one-shot presentation, and idempotent presentation
callbacks are suppressed and counted. Invalid history windows, world or entity revision
changes, non-finite commands, and invalid family-kernel results reject replay without
partially publishing output. Phaser and Three now share one render-only correction
smoothing policy, so canonical simulation corrections remain immediate while visual
offsets decay.

The F3 network diagnostics expose retained history, replay count and ticks, p95 replay
duration, pair steps, suppressed effects, and hard resets. M7 deliberately enables live
history capture and the generic replay coordinator only. No dynamic interaction family
publishes replay output yet; M8 activates vehicle-to-vehicle contacts through the
injected family hook.

The dedicated netcode gate passes 68 tests, including the exact 32-body / 24-tick
maximum work envelope of 768 body steps and 11,904 stable pair evaluations. The complete
repository gate passes 357 tests, TypeScript and the optimized production build pass,
and the real two-client Colyseus scenario passes in 18.8 seconds.

### M8: Vehicle-to-Vehicle Interaction Replay - Complete

- Share one deterministic oriented-box contact kernel between authority and replay.
- Advance every authoritative vehicle body before resolving stable dynamic pairs.
- Replay local saved vehicle input and bounded remote physical intent from one baseline.
- Replace saved prediction history atomically so the next state patch cannot undo replay.
- Publish corrected local and promoted remote vehicle poses through both renderers.

Gate: a two-player vehicle contact predicted through 150 ms RTT reaches the same contact
tick, position, and speed as authority without replaying damage or other side effects.

This checkpoint originally used a shared oriented-box contact kernel. The completed
Rapier migration supersedes that implementation: server authority and client replay now
use `PhysicsWorld`, while server controllers alone apply damage and other outcomes. See
`COLLISION_ARCHITECTURE.md` for the current ownership boundary.

Authority now has explicit fixed-tick phases. Every vehicle first advances its body and
updates its broad-phase record. `finishTick()` then traverses vehicle roots and nearby
candidates in stable ID order, resolves each unordered pair once, synchronizes occupants,
and returns moved bodies for spatial reindexing. This removes the previous ordering bug
where one car could collide against another car's prior-tick pose. Tests prove that the
result matches the shared kernel and is independent of state insertion or body-update
order.

The vehicle family adapter activates only when the controlled root is a vehicle, another
vehicle is in the selected island, and contiguous saved local moves cover the baseline.
Each replay tick maps one saved move sequence to one server tick. Successful replay
replaces those historical predicted poses, advances canonical local prediction, retires
the authoritative acknowledgement, and preserves newer pending moves as one atomic
operation. A matching state patch is consumed without immediately re-running ordinary
reconciliation. Corrected remote vehicle poses are promoted until a newer authoritative
server time arrives.

Replay collision damage is dispatched through the authoritative-gameplay side-effect
class and suppressed. Invalid command coverage, revisions, root identity, result traces,
or occupancy transitions reject replay without publishing partial state. Phaser and
Three compose the same family adapter and correction policy.

The dedicated netcode gate passes 74 tests. The 150 ms deterministic two-car impairment
scenario has zero final position and speed divergence and identifies the same contact
tick. The complete repository gate passes 363 tests, TypeScript and the optimized
production build pass, and the isolated real two-client Colyseus scenario passes in
18.9 seconds.

### M9-M10: Remaining Interaction Families

- M9: humanoid impacts, vehicle entry/exit, passenger constraints, and attachments.
- M10: predicted projectile correlation plus server historical hit queries.

M9 is split into independently deployable checkpoints:

- M9a - Complete: protocol-v3 control epochs. Every per-client baseline carries a
  validated `on-foot`, `driver`, or `passenger` control mode and a monotonic control
  revision. Entry, exit, seat reassignment, passenger promotion, root replacement, or a
  missed control frame advances the revision. Client island history clears whenever
  either value changes, including passenger-to-driver promotion where the vehicle root
  ID remains unchanged.
- M9b - Complete: one effective predicted transform for body, weapon, passenger, label,
  lights, camera, minimap marker, and debug collider. Phaser and Three use the same pure
  attachment policy. Local minimap and active debug colliders consume the predicted
  attachment root, and occupied players no longer expose a duplicate humanoid collider.
- M9c-a - Complete: shared OBB-circle vehicle-to-humanoid contact. The authoritative
  adapter resolves stable pairs after vehicle, player, and pedestrian body steps; uses
  per-pair impact records; reindexes corrected actors; and keeps damage, knockdown,
  crime, and other lifecycle effects server-only. Physical relative closing speed is
  distinct from vehicle-caused impact speed so walking into a stationary car can never
  become a server-authored ram.
- M9 observability - Complete: the F3 panel exposes selected bodies, weighted
  points/budget, conservative overflow, dynamic horizon, baseline age, retained history,
  replay ticks/duration, and reset counts. It also lists the stable root/member order,
  admission reason, TTC, and overflow IDs. Phaser and Three draw authoritative selected
  and overflow colliders by reason, root-to-member links, and the corresponding presented
  pose separately, so a predicted collider can be compared directly with authority.
  Budget/horizon and replay workload use separate wide rows, including pair steps and
  suppressed replay effects; both browser shells expose the same per-reason color legend.
- M9c-b: on-foot saved-input island replay using the same vehicle-to-humanoid kernel,
  including promoted remote humanoid poses and replay-side-effect suppression.
- M10a: bounded server-owned combat hitbox history with lifecycle-safe interpolation,
  stable segment queries, and a 200 ms public rewind cap.
- M10b: validated, monotonic combat-fire commands with authoritative projectile catch-up,
  current-world obstruction, historical actor queries, and explicit spawn receipts.
- M10c: immediate renderer-neutral local projectile presentation in Phaser and Three,
  followed by receipt correction and duplicate-free authoritative spawn handoff. Rejected,
  resolved, malformed, and timed-out commands retire their presentation without mutating
  gameplay authority.

Bullets now predict recoil and projectile presentation while the server performs bounded
rewound hit validation. Grenades and rockets may use deterministic predicted spawns.

### M11: Production Rollout

- M11a - Complete: negotiate one immutable, server-owned rollout manifest before enabling
  remote timelines, interaction snapshots, interaction replay, combat rewind, or local
  projectile presentation. Invalid environment flags and dependency combinations fail
  room startup; incompatible or silent servers leave clients on fail-closed kernel-only
  legacy behavior. Both debug shells expose negotiation state, revision, and every active
  stage, and the rollout runbook defines compatibility, verification, and rollback order.
- M11b - Complete: an eight-client, 48-body deterministic soak runs the production
  selector, weighted admission, history, remote-intent continuation, mixed kernels, stable
  pairs, and side-effect gate through latency, jitter, reliable retransmission, dense
  overflow, stream-in/out, destruction, respawn, and occupancy transitions. At the 150 ms
  RTT / 30 ms jitter / 1% loss target, 1,808 replays completed with zero rejection, 0.195
  ms replay p95, 0.122 px root-error p95, no budget violation or duplicate effect, and
  exact final convergence. The dedicated gate enforces the 2 ms p95 target.
- Production order: shared kernels first, remote timelines second, interaction snapshots
  third, and interaction replay last. Combat rewind and projectile prediction use their
  own dependency-checked lane.

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
- [M11 interaction-island soak report](INTERACTION_ISLAND_SOAK_REPORT.md)
- [Colyseus-native prediction decision](decisions/0005-colyseus-native-prediction.md)

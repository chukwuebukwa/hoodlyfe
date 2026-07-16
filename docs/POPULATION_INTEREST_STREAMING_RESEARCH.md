# Population Interest and Virtualization Research

Date: 2026-07-15

## Scope

This milestone answers one question: should NOCK0 fully simulate ambient pedestrians and
traffic when no player can observe or interact with them? No. Ambient population should
exist as full authoritative actors only around the union of player interest areas, with a
bounded prewarm ring outside presentation range and compact virtual records everywhere
else.

The educational references were inspected at these pinned revisions:

- re3 commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`;
- reVC commit `b9eeb33efcd04a5b7a423921609baef11bf4719a`.

The reference repositories are read-only behavioral inputs. NOCK0's TypeScript policy,
distances, data model, tests, and multiplayer adaptation are original implementation.

## Reference Behavior

### Pedestrian lifecycle

reVC calls population management, pool-pressure cleanup, abandoned-zone cleanup, and
distance-bounded creation from `CPopulation::Update` (`src/peds/Population.cpp:361-384`).
`AddToPopulation` derives types and budgets from zone, time, wanted level, weather, and
mission state (`Population.cpp:521-564`). A candidate inside the camera sphere is rejected
when it is too near the player (`Population.cpp:710-714`).

Deletion is equally conditional. Disposable, non-player pedestrians are considered over
distance slices; gang, accident, death, visibility, camera mode, and an extended-range
timer affect removal (`Population.cpp:1079-1129`). The related constants create separate
creation and removal thresholds (`Population.cpp:32-36`), providing hysteresis rather
than one unstable boundary.

re3 exposes the same lifecycle shape in `src/peds/Population.cpp:421-435`,
`Population.cpp:572-590`, `Population.cpp:708-715`, and `Population.cpp:1124-1142`.
reVC adds more explicit pool-pressure and extended-range handling, but does not change the
central invariant: disposable ambient actors are generated around the player, protected
while relevant, and removed outside presentation.

### Traffic lifecycle

reVC bounds random traffic by a global cap and zone/player density
(`src/control/CarCtrl.cpp:113-147`). Candidate cars are initialized before admission, start
transparent, are rejected at unsuitable visible or invisible distances, and must pass
collision checks (`CarCtrl.cpp:550-625`). This avoids creating an overlapping car or
placing one conspicuously near the player.

`RemoveDistantCars` and `PossiblyRemoveVehicle` preserve interesting, locked, undeletable,
garage, service, law-enforcement, and set-piece vehicles (`CarCtrl.cpp:903-1028`). Ordinary
offscreen cars can be removed immediately, visible cars fade, and stopped ordinary traffic
has a separate five-second cleanup path when it is not legitimately waiting at a signal,
bridge, or garage.

re3 implements the corresponding generation and cleanup boundaries in
`src/control/CarCtrl.cpp:91-107`, `CarCtrl.cpp:544-558`, and `CarCtrl.cpp:700-789`.
reVC's additional categories and timers reinforce the same production principle: world
population is a managed presentation around gameplay, not a globally persistent physics
simulation.

## Multiplayer Adaptation

A single-player camera test cannot be copied directly into a multiplayer server. The
server owns no trusted camera frustum, and an actor hidden from one client may be visible to
another. NOCK0 therefore evaluates the nearest distance to the union of all street-player
anchors and uses conservative server-known radii:

| Tier | Nearest-player distance | Full actor | New materialization | Purpose |
| --- | ---: | --- | --- | --- |
| Hot | `0..720` px | Retained | No | Conservative normal-camera presentation envelope |
| Prewarm | `720..1,280` px | Retained | Yes | Simulate and replicate before presentation |
| Retained | `1,280..1,536` px | Retained | No | AOI hysteresis while an actor leaves interest |
| Cold | `>1,536` px | No | No | Compact virtual record only |

The 1,280/1,536 thresholds deliberately match street replication enter/exit hysteresis.
The 720-pixel presentation guard exceeds the ordinary Three camera footprint while leaving
a 560-pixel prewarm band inside replication admission. It also permits a prewarmed
pedestrian to participate in the existing 760-pixel witness envelope instead of making
every nearby crime structurally unreportable. An actor is authoritative and received by
the client before it can enter normal presentation. These values are NOCK0 tuning, not
converted GTA world units.

### Admission and pop-in

A dormant candidate can materialize only in the prewarm ring. It cannot be created inside
the protected view of **any** street player. The ring is inside the replication enter
radius, so the client receives the actor while it is still outside presentation. If a
coarse virtual step places a dormant record directly in hot space, the record remains
hidden (`pop guarded`) until interest geometry makes a safe prewarm admission possible.

### Dormant state

Cold pedestrians and traffic are absent from Colyseus schema collections, spatial indices,
collision, AI, traffic junctions, and interaction-island history. Their compact records
advance wander/route state in bounded three-second coarse steps. This preserves plausible
movement without spending a district tick on every potential actor.

The active ceilings remain 40 pedestrians and 24 traffic cars across 80 and 64 potential
records. These are global safety limits.

### Fair multiplayer neighborhood capacity

The references retain one global pool and protect visible or non-disposable state during
cleanup. See re3 pedestrian update, speed scaling, admission, and cleanup
([Population.cpp:421-441](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.cpp#L421-L441),
[478-487](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.cpp#L478-L487),
[572-600](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.cpp#L572-L600), and
[1107-1171](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.cpp#L1107-L1171)) and the corresponding reVC lifecycle
([Population.cpp:361-383](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/Population.cpp#L361-L383),
[407-416](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/Population.cpp#L407-L416),
[521-569](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/Population.cpp#L521-L569), and
[1079-1159](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/Population.cpp#L1079-L1159)).
Neither reference needs to divide that pool among disconnected multiplayer viewpoints.

NOCK0 adds that adaptation. Overlapping 1,536-pixel retention envelopes form deterministic
player-interest components. Lookahead belongs to its real player's component and cannot
create capacity by itself. Disconnected components divide the 40/24 ceilings equally, and
materialization rotates between under-quota components. A busy component may borrow capacity
that no other component currently needs, preventing an idle neighborhood from making the
room artificially sparse. When demand later appears in a full room, only offscreen,
disposable borrowed actors above another component's share can be virtualized, using the
existing five-pedestrian/five-traffic per-tick removal budgets.
Hot or pinned actors defeat fairness rather than disappear; the resulting pressure remains
visible in diagnostics. This is room-cap fairness, not zone density or per-player copies.

### Speed-aware lookahead

Pinned re3 `Population.cpp:425-441,478-487` and reVC
`Population.cpp:361-383,407-416` multiply pedestrian creation distance by a clamped
player-vehicle speed factor. Their `CarCtrl.cpp` generation paths (re3 `150-213`, reVC
`174-220`) use normalized vehicle velocity and prefer a narrow forward sector at high speed.
Spawn candidates still pass visibility, distance, and collision rejection before admission.

NOCK0 adapts the relationship rather than the single-player camera code. Every street player
keeps one real visibility guard. A player in a vehicle moving at least 120 px/s adds a
server-authored lookahead anchor at signed speed times 1.5 seconds, clamped to 480 pixels.
That anchor extends prewarm/retention ahead while driving and behind while reversing, but it
never protects visibility. Therefore it can request population in future space without
allowing dormant actors to appear inside any player's current 720-pixel guard.

### Protected gameplay state

Streaming fails closed. Occupied, hijacked, mission-owned, burning, destroyed, meaningfully
damaged, combat-engaged, or otherwise non-disposable actors remain authoritative even when
far away. Parked/service vehicles remain persistent bootstrap entities for now. Durable
ownership should eventually serialize into compact persistence rather than rely on an
ambient virtual record.

## Netcode Boundary

Population activation is server-only world lifecycle policy. It does not run inside client
prediction, rewind, reconciliation, or interaction-island selection. Once a materialized
actor is physically relevant, the existing replication and interaction-island systems may
select its authoritative physical state. Cold records never enter those systems.

## Diagnostics

F3 Population reports:

- active versus potential actors;
- hot actors;
- warm actors (prewarm plus retained);
- cold virtual records;
- predictive high-speed lookahead anchors;
- deterministic interest components and components under quota pressure;
- cumulative safe quota rebalances;
- pop-guarded records that cannot safely materialize;
- pinned gameplay actors;
- cumulative invisible-jam retirements.

This makes sparse population, active-cap pressure, bad activation radii, and pop-in guards
observable without drawing every virtual record in the world.

## Remaining Work

- Author zone/time density profiles and pedestrian destinations instead of uniform records.
- Add pursuit, mission, property, and group-event anchors.
- Consider a clamped, server-validated camera presentation hint for unusual ultrawide or
  zoom modes; it must only enlarge the guard and never remove actors another player needs.
- Persist owned or narratively important actors independently from ambient virtualization.

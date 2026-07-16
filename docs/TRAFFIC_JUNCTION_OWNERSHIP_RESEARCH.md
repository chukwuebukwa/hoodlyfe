# Traffic Junction Ownership Research

Date: 2026-07-16

Status: G2b.1 implemented; multi-lane geometry added in G2c; compatible movement ownership
implemented in G2b.2b

## Scope

This milestone addresses dense-junction pileups after G2a introduced authored directed
lanes. It does not attempt lane changes, general swept collision avoidance, or arbitrary
multi-vehicle deadlock resolution. Those remain G2b.2 and G2c work.

The re3 and reVC repositories were read as educational references at pinned revisions.
NOCK0 does not copy their implementation. The TypeScript state machine, tuning, debug
contract, and tests are original multiplayer adaptations.

## Pinned Reference Behavior

### re3

- [`TrafficLights.cpp` lines 137-202](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/TrafficLights.cpp#L137-L202)
  scans map lights once and annotates nearby car path links and pedestrian crossings. The
  signal contract belongs to authored path topology rather than a global road mask.
- [`TrafficLights.cpp` lines 205-271](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/TrafficLights.cpp#L205-L271)
  examines next, current, and for physics vehicles previous path links. A car stops only in
  a short directional window before the controlled link; a car that passed the line is not
  frozen in the junction.
- [`CarCtrl.cpp` lines 806-854](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L806-L854)
  keeps temporary waiting, traffic/light speed policy, route progression, lane positions,
  curve evaluation, and physical movement as separate layers.
- [`CarCtrl.cpp` lines 923-942](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L923-L942)
  converts a signal or traffic reason into a maximum-speed constraint. It does not teleport
  or directly mutate route ownership.
- [`CarCtrl.cpp` lines 762-775](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L762-L775)
  distinguishes legitimate signal stops from abandoned traffic when cleaning up offscreen
  cars.

### reVC

- [`TrafficLights.cpp` lines 311-370](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/TrafficLights.cpp#L311-L370)
  preserves topology annotation while changing how light geometry intersects candidate path
  links.
- [`TrafficLights.cpp` lines 373-445](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/TrafficLights.cpp#L373-L445)
  preserves the next/current/previous-link stop-window architecture with explicit direction
  metadata.
- [`CarCtrl.cpp` lines 1177-1195](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1177-L1195)
  retains speed-policy ownership while tuning deceleration more aggressively than re3.

The shared production lesson is not a literal reservation algorithm. It is that authored
path state determines right of way, stopping happens before the controlled segment, cars
already committed continue through, and low-level movement remains separate from policy.

## NOCK0 Failure Audit

The old boolean reservation reduced simultaneous entry but could still produce a jam:

- a fixed three-second lease could expire during a slow crossing;
- ownership released when the center reached the outgoing node, while the rear collider was
  still inside the conflict zone;
- a signal-stopped vehicle could acquire ownership too early and reduce throughput;
- the system did not account for a player car or pedestrian physically occupying an authored
  conflict center;
- denied cars received a virtual obstacle at the junction target rather than at a stop line;
- reservation began up to 150 pixels away, leaving the junction idle while the owner was
  still approaching.

## Multiplayer Adaptation

NOCK0 adds a server-authoritative FIFO admission state machine because player-controlled and
networked vehicles can enter the same physical space. It has five visible phases:

1. `none`: no junction relationship;
2. `waiting`: queued but not admitted;
3. `approach`: admitted and before the commit line;
4. `crossing`: the route remains inside the same authored junction;
5. `clearing`: the center reached the outgoing node, but ownership remains until the rear
   collider clears it.

The owner renews its lease every server update. Lease expiry only recovers abandoned actors.
Admission is deterministic by queue arrival time and vehicle ID. A blocked approach owner
relinquishes admission without losing FIFO position; a committed or crossing vehicle keeps
moving so a late signal or obstacle cannot strand it in the intersection. Hijacking, route
recovery, release, and controller teardown explicitly remove stale queue state.

Original single-lane tuning:

| Parameter | Value | Purpose |
| --- | ---: | --- |
| Admission distance | 112 px | Queue near the controlled connector without reserving a block early. |
| Commit distance | 60 px | Prevent a new stop after the vehicle has entered the final approach. |
| Conflict radius | 34 px | Reject admission while an unqueued physical actor occupies the center. |
| Virtual stop offset | 34 px | Stop denied traffic before the connector target. |
| Rear-clearance margin | 12 px | Add space beyond half the catalog vehicle length before release. |
| Abandonment lease | 3000 ms | Recover ownership only if the owner stops updating. |

G2c replaces the fixed conflict and stop geometry for authored lane routes:

- each junction derives X/Y half-extents from every compiled lane node it owns;
- physical occupancy checks the expanded authored bounds;
- stop and rear-clear distance project those bounds onto travel direction;
- request lookahead includes current catalog braking distance and a safety buffer;
- the stop point is fixed from the lane segment rather than recomputed from the car;
- terminal turnarounds become synthetic FIFO conflict zones shared by every lane.

See [`TRAFFIC_LANE_CHANGE_RESEARCH.md`](TRAFFIC_LANE_CHANGE_RESEARCH.md) and
[`decisions/0017-authored-lane-change-ownership.md`](decisions/0017-authored-lane-change-ownership.md).

G2b.2b replaces junction-wide exclusivity for complete authored routes with a bounded
pairwise-compatible owner set:

- `TrafficRouteSystem` derives entry, traversal, and exit lane identity plus a short swept
  path through the authored conflict bounds;
- a pure symmetric foe policy rejects shared entry or exit lanes, intersecting/near paths,
  malformed descriptors, fallback routes, and terminal U-turns;
- compatible movements may acquire, renew, cross, clear, expire, and release independently;
- older unblocked conflicting waiters retain deterministic priority, while unrelated
  compatible streams may continue;
- the low-level driver ignores only active compatible owners, not every queued car.

See [`TRAFFIC_MOVEMENT_CONFLICT_RESEARCH.md`](TRAFFIC_MOVEMENT_CONFLICT_RESEARCH.md) and
[`decisions/0018-junction-movement-conflict-matrix.md`](decisions/0018-junction-movement-conflict-matrix.md).

Physical occupancy admission is intentionally limited to authored lane-graph routes. The
legacy collision-grid adapter marks broad road cells as intersections and cannot infer a
safe conflict center. Applying the same radius there would recreate false waits across
ordinary streets.

## Invariants and QA

- Every pair of vehicles in `approach`, `crossing`, or `clearing` for one junction has
  nonconflicting authored movement descriptors.
- The owner set is bounded; fallback, malformed, and terminal-turnaround movements remain
  junction-exclusive.
- Queue order is deterministic and survives a temporarily blocked head.
- A denied car remains stopped before the connector during prolonged occupancy.
- A committed vehicle is not stopped inside the conflict zone.
- Ownership persists until the complete vehicle footprint clears.
- Crossing and clearing suppress reverse/pass recovery and emergency yielding.
- One-minute dense-flow soak observes all lifecycle phases, compatible simultaneous owners,
  no conflicting owner pair, bounded queue growth, continued route progress, and completed
  traversals.
- F3 exposes junction phase, queue position, lease, movement, shared/conflict counts, and a
  color-coded center link/ring; Three draws active movement paths.

## Netcode Boundary

Junction queues, signals, occupancy admission, route selection, and traffic AI execute only
on the district server. Nearby traffic may be promoted into an interaction island as a
physical body with bounded applied intent, but the client never runs this state machine
during prediction or replay. G2b.1 changes no prediction, reconciliation, interpolation,
AOI, rewind, rollout, or shared movement/contact implementation.

## Remaining Work

- G2c follow-up: richer driver-style willingness, abort-to-origin behavior, and permanent
  route-driven merge reservations.
- Content: authored stop lines, per-movement signal groups and response priority, lane
  capacity, turn restrictions, and parking/service access metadata.

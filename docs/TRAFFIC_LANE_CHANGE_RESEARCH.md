# Authored Traffic Lane-Change Research

Date: 2026-07-16

Status: G2c authored lane-change slice implemented

## Scope

This milestone replaces free-form queue passing on multi-lane authored roads with an
explicit server-authoritative maneuver. It also upgrades junction ownership so adding
parallel lanes does not move physical conflict points outside the protected area.

The pinned re3 and reVC repositories are unlicensed reversed sources. They were read only
to identify production behavior and system boundaries. NOCK0's TypeScript policy,
reservation protocol, geometry, tuning, and tests are original clean-room adaptations.

## Pinned Reference Behavior

### Route and lane state are separate

- [re3 `AutoPilot.h` lines 55-84](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/AutoPilot.h#L55-L84)
  stores previous/current/next route nodes, previous/current/next path links,
  current/next lane, driving style, mission, temporary action, and maximum traffic speed as
  separate state.
- [re3 `CarCtrl.cpp` lines 1510-1670](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L1510-L1670)
  derives legal turn directions from lane position, promotes next lane to current lane,
  optionally changes lane only on a sufficiently long link, clamps the result to authored
  lane count, and builds the next curve from current-lane and next-lane offsets.
- [reVC `CarCtrl.cpp` lines 1765-1936](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1765-L1936)
  preserves that architecture while adding deterministic route seeding and stronger
  one-way-road filtering.

The transferable rule is that lane count belongs to road content, lane choice belongs to
autopilot state, turn legality consumes lane state, and low-level curve following consumes
the resulting lane offsets. A lane change is not an arbitrary sideways steering impulse.

### Ordinary following and aggressive weaving are different policies

- [re3 `CarCtrl.cpp` lines 857-889](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L857-L889)
  scans nearby vehicles and pedestrians to derive a maximum traffic speed for ordinary
  driving.
- [reVC `CarCtrl.cpp` lines 1111-1143](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1111-L1143)
  keeps the same speed-limiting boundary and varies the result by driving style.
- [re3 `CarCtrl.cpp` lines 1239-1293](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L1239-L1293)
  and [reVC `CarCtrl.cpp` lines 1491-1545](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1491-L1545)
  use a separate bounded obstacle-envelope search for weaving behavior.

NOCK0 therefore keeps lawful following in `TrafficAwarenessSystem`, existing single-lane
emergency detours in `TrafficManeuverSystem`, and authored multi-lane passing in a separate
`TrafficLaneChangeSystem`.

## NOCK0 Failure Audit

The first prototype exposed three structural failures in the one-minute traffic soak:

1. Long diagonal route edges changed lanes without maneuver ownership. Two cars could
   converge on one lane node or cross opposite transition paths.
2. Multi-lane offsets moved physical intersection crossings up to 64 pixels away from the
   old single-point junction envelope.
3. A denied car's stop marker was recomputed from its current position. After overshooting
   the intended line, the marker moved forward to the junction node and allowed the car to
   stop inside the conflict area.

The initial multi-lane soak reached 2,940 overlap pair-ticks. The final design records zero.
The threshold was not loosened.

## Authored Lane Model

Lane schema version 2 adds:

- `lanesPerDirection` on selected corridors;
- district-wide `laneSpacing`;
- immutable `laneIndex` and `laneCount` on compiled nodes;
- legal lane-specific junction connectors;
- adjacent parallel-lane lookup for maneuver planning.

The route graph contains stable lane, junction connector, and serialized turnaround edges.
It intentionally does not contain free diagonal lane-change edges. Permanent route-level
lane transitions require the same explicit reservation and merge ownership as passing; an
unowned path edge is not a safe substitute.

Left turns originate from the inner lane, right turns from the outer lane, and straight
movement preserves or clamps lane index. The existing single-lane corridors keep the whole
district strongly connected.

## Lane-Change Policy

`traffic-lane-change-policy.ts` is a pure admission function. It builds entry, pass, and
return points only when:

- the current segment has an authored adjacent lane;
- a slow vehicle is ahead within the bounded scan range;
- bumper clearance leaves enough longitudinal distance to complete the lateral move;
- the full sampled trajectory remains road-safe and occupiable;
- the target lane has safe front and rear gaps using catalog vehicle extents and relative
  speed;
- no pedestrian or signal protects the trajectory;
- the return completes before the junction margin.

Denied plans expose stable reasons such as `lead-clearance`, `target-rear-gap`,
`target-signal`, and `junction-near`.

## Deterministic Ownership

`TrafficLaneChangeSystem` owns private per-car phases:

```text
none -> requesting -> change-out -> passing -> returning -> none
```

- A slow lead must remain relevant for 900 ms.
- Requests are grouped by adjacent-lane segment and distance bucket.
- Arbitration occurs on the next server tick.
- Oldest request wins; stable vehicle ID is the final tie-breaker.
- One reservation remains live through return or a bounded timeout.
- Signal, pedestrian, siren, hijack, protected-junction, deadlock, and release paths cancel
  the maneuver.
- The lead is ignored only during the committed maneuver. All other authoritative
  obstacles remain active.

The existing free-form pass system is suppressed for authored multi-lane vehicle queues.
It remains a compatibility fallback for single-lane blockage and pedestrian detours.

## Multi-Lane Junction Extension

`LaneGraph` derives an axis-aligned conflict footprint from all lane nodes owned by a
junction. Stop and clearance distance project that footprint onto the current travel
direction. This avoids the over-conservative circumscribed-circle hold for cardinal roads
while preserving diagonal connector coverage.

Terminal turnarounds are synthetic named junctions. All lanes at one road end share one
FIFO owner, so a U-turn cannot cross opposing lanes without admission.

Denied cars receive a stop line fixed from authored lane geometry. Ownership lookahead
includes the catalog braking distance and a safety buffer. A car that reaches the stop line
without a grant is authoritatively braked instead of advancing the marker.

## Multiplayer Contract

Route selection, lane-change admission, arbitration, phase progression, queue state, and
junction ownership execute only on the district server. Debug snapshots may expose copied
phase and target facts to an opted-in subscriber.

No prediction, reconciliation, remote interpolation, AOI selection, interaction-island
admission/replay, combat rewind, rollout policy, or shared movement/contact kernel changes
are part of this milestone. A promoted traffic car remains an ordinary physical body in an
interaction island; the client never runs traffic AI.

## Debug and QA

F3 appends active lane changes, pending requests, and cumulative completed passes to the
traffic/junction row. The Three debug overlay draws the current maneuver trajectory and
entry ring in blue.

Deterministic coverage includes:

- multi-lane graph validation and turn-lane ownership;
- safe plan, rear-gap rejection, lead-clearance rejection, protected queue rejection, and
  junction-margin rejection;
- deterministic competing-request arbitration;
- full maneuver phase progression and protected-junction cancellation;
- real `TrafficController` integration through completion;
- one-minute dense traffic circulation with bounded queues and zero oriented-box overlap
  pair-ticks.

## Deferred Work

- Compatible simultaneous junction movements through a movement-conflict matrix.
- Permanent route-driven lane transitions with explicit merge reservations.
- Driver-style-specific willingness, signaling presentation, and abort-to-origin behavior.
- Original map content with authored stop bars, turn pockets, parking access, and lane
  closure metadata.

# Visible Traffic Deadlock Recovery Research

Date: 2026-07-15

Status: G2c visible blocker-cycle recovery implemented

## Scope

This milestone resolves persistent traffic deadlocks that remain visible to a player. It is
separate from offscreen population pressure relief: visible traffic must recover in place
instead of disappearing. The implementation detects strongly connected vehicle blocker
cycles, elects one bounded recovery owner, verifies rear clearance, and then returns that
car to ordinary route policy.

The re3 and reVC repositories were inspected at pinned revisions as educational references.
NOCK0 does not copy their implementation. Its blocker graph, stable election, clearance
policy, TypeScript module, diagnostics, and multiplayer integration are original work.

## Pinned Reference Behavior

### re3

- [`CarCtrl.cpp` lines 1054-1113](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L1054-L1113)
  performs bounded nearby-vehicle filtering, moving-rectangle projection, and ordinary
  slowdown. If two opposing non-player cars remain standing for 15 seconds, stable pointer
  ordering selects only one car, gives it a small minimum speed, switches it to physical
  simulation if needed, and applies a one-second avoid-cars override.
- [`CarCtrl.cpp` lines 2058-2089](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L2058-L2089)
  represents wait and reverse as deadline-bounded temporary actions. Expiry returns the car
  to ordinary mission steering rather than permanently changing its route mission.

### reVC

- [`CarCtrl.cpp` lines 1306-1366](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1306-L1366)
  retains the same one-victim, 15-second opposing-car escape behavior while retuning the
  normal moving-rectangle slowdown range.
- [`CarCtrl.cpp` lines 2310-2340](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L2310-L2340)
  retains explicit wait/reverse temporary actions with a fixed expiry and then restores
  normal AI control.

The transferable production pattern is not a magic despawn or unrestricted pass. It is:

1. keep normal collision prediction and lawful stopping as the default;
2. confirm that a stop is persistent rather than transient queue pressure;
3. choose exactly one actor by a stable rule;
4. apply a bounded temporary recovery behavior;
5. return to the original mission and driving policy.

## NOCK0 Failure Audit

A live central-junction probe found a functional blocker graph with a cycle. An unqueued car
already inside the conflict area prevented the FIFO leader from receiving a reservation,
while that occupant simultaneously treated a queued car as its own blocker. Followers then
extended the cycle into a visible pileup. Lowering population only delayed the same failure.

The existing `TrafficManeuverSystem` could recover from one stationary obstacle, but it
correctly suppressed ad-hoc passing near signals and pedestrians. It had no global view of
the resulting mutual wait graph, so every local decision could be individually reasonable
while the combined system made no progress.

## Multiplayer Adaptation

`TrafficDeadlockSystem` consumes the previous authoritative tick's observations. Each
stationary traffic vehicle contributes at most one directed edge to the stationary vehicle
currently limiting it. The system finds deterministic cycles in that functional graph and
requires the same cycle to persist for six seconds. This is longer than the ordinary
two-second single-obstacle maneuver threshold, but shorter than the reference games'
15-second fallback because NOCK0's compact top-down intersections reach full blockage more
quickly.

Only one recovery owner is elected per cycle. Unreserved conflict occupants rank ahead of
FIFO waiters, then approaches, crossings, and clearing cars; stable vehicle ID breaks ties.
A candidate must have an authored road and collision-clear 48-pixel reverse corridor. If no
cycle member has safe rear space, the system waits rather than forcing penetration.

The command lasts 950 ms and has an eight-second cycle cooldown. `TrafficController`
releases only the elected owner's junction claim, resets its temporary maneuver/yield state,
and delegates reverse motion to the existing collision-aware `RoadDrivingSystem`. The
long-lived route mission is unchanged and resumes after command expiry.

## Population Relationship

`traffic-jam-retirement-policy.ts` remains the separate offscreen safety valve. It may retire
sustained disposable ambient blockers only beyond every player's 1,536-pixel replication
radius, in batches of at most two. Occupied, mission, hijacked, burning, destroyed, or
visible vehicles remain protected.

The two policies intentionally differ:

- invisible disposable jam: retire a bounded number and advance virtual route state;
- visible jam: preserve actors and use one deterministic physical recovery owner.

## Diagnostics and QA

- F3 Junctions reports unique blocker cycles and active recovery owners.
- The Three debug overlay draws blocker-cycle links in purple and the elected owner/link in
  magenta with an owner ring.
- Unit coverage verifies deterministic election independent of observation order, preference
  for an unreserved occupant, queue/moving-traffic exclusion, rear-clearance failure, command
  expiry, and cooldown.
- A controller scenario proves exactly one car reverses from a persistent mutual block.
- The 23-car one-minute soak now runs the production observation path and retains its prior
  throughput, junction ownership, and overlap bounds.

## Netcode Boundary

Deadlock detection and traffic recovery are server-only ambient AI. They do not run in local
prediction or interaction-island replay. The existing authoritative vehicle pose and applied
motion are replicated normally; player-controlled cars remain outside this policy. Shared
movement/contact kernels, saved-input resimulation, interpolation, rewind, AOI selection,
and rollout code are unchanged.

## Remaining Work

- G2b.2b: movement-class conflict arbitration for compatible simultaneous turns.
- G2c: authored lane-change and queue-aware passing decisions beyond the existing local
  maneuver probes.
- A larger authored multi-junction soak with measured queue-clearance percentiles.


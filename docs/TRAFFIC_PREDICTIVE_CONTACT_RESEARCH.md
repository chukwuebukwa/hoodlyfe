# Traffic Predictive Contact Research

Date: 2026-07-15

Status: G2b.2a implemented

## Scope

This milestone replaces circular vehicle look-ahead with catalog-sized oriented footprints
and relative time-to-contact speed policy. It addresses angled impacts and collision chains
that can form before center-distance following logic recognizes a blocker. It does not add
compatible simultaneous junction movements, lane changes, or general deadlock arbitration.

The re3 and reVC repositories were inspected at pinned revisions as educational references.
NOCK0 does not copy their implementation. The continuous SAT calculation, TypeScript policy,
tuning, diagnostics, and multiplayer integration are original work.

## Pinned Reference Behavior

### re3

- [`CarCtrl.cpp` lines 856-890](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L856-L890)
  performs a bounded spatial scan and reduces one maximum traffic speed from nearby vehicles
  and pedestrians.
- [`CarCtrl.cpp` lines 923-942](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L923-L942)
  turns traffic and signal observations into a smoothed speed limit rather than directly
  moving or teleporting a car.
- [`CarCtrl.cpp` lines 944-1051](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L944-L1051)
  projects pedestrian danger over a bounded horizon and uses the vehicle's actual front and
  side dimensions before selecting stopping or evasive behavior.
- [`CarCtrl.cpp` lines 1054-1113](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L1054-L1113)
  filters nearby physical vehicles, rejects vehicles behind the driver, compares relative
  velocity, and applies the most restrictive projected proximity.
- [`CarCtrl.cpp` lines 1116-1237](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L1116-L1237)
  tests both vehicles' oriented rectangle corners against their relative movement and actual
  model extents.

### reVC

- [`CarCtrl.cpp` lines 1198-1303](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1198-L1303)
  retains bounded projected pedestrian response and model-sized lateral filtering.
- [`CarCtrl.cpp` lines 1306-1366](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1306-L1366)
  preserves relative moving-rectangle traffic policy while widening and retuning its
  slowdown range.
- [`CarCtrl.cpp` lines 1368-1489](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L1368-L1489)
  keeps the symmetric oriented-rectangle projection architecture.

The production lesson is architectural: discover a bounded candidate set, reason about the
real footprint and relative movement, reduce observations to desired speed, and keep physical
integration and contact solving below that policy.

## NOCK0 Failure Audit

The prior awareness system projected obstacle centers into one circular forward corridor.
That caused two opposite errors:

- angled cars could enter each other's real rectangular footprint while their centers still
  appeared laterally separated;
- adjacent parallel lanes could trigger false braking because two 20-pixel circles were wider
  than the catalog vehicle bodies;
- future path intersection was not considered until a car was already in the forward strip;
- the dense-flow soak checked throughput but did not bound real oriented-box overlap time.

## Multiplayer Adaptation

`traffic-predictive-contact.ts` implements continuous separating-axis intervals for two
oriented boxes translating at constant velocity over a short horizon. The four axes from
both boxes produce entry and exit intervals; their intersection is the first predicted
contact time. Rotation remains fixed over the bounded awareness horizon because traffic
policy is sampled every authoritative 30 Hz step.

`TrafficAwarenessSystem` now combines two independent constraints:

1. catalog-projected longitudinal/lateral following distance for same-corridor behavior;
2. swept oriented-box time to contact for angled and crossing paths.

The most restrictive desired speed wins deterministically. TTC is mapped through a response
horizon derived from following time and current braking time, bounded from one to three
seconds. A four-pixel margin absorbs fixed-step and steering approximation. A vehicle whose
center is fully behind the ego car does not make the ego brake; rear traffic owns rear-end
avoidance.

The admitted owner of an authored junction ignores cars queued for that same junction.
G2b.1 already guarantees those cars remain before the conflict segment. Without this rule,
the predictive layer would correctly detect intersecting route geometry but incorrectly
override the higher-level right-of-way contract, reducing throughput and risking a stop in
the conflict zone. Unadmitted cars, unqueued cars, and player vehicles remain ordinary
physical obstacles.

## Diagnostics and QA

- F3 exposes **Traffic risk** as predicted count, urgent count, and minimum TTC.
- The Three debug view draws an orange limiting-obstacle link, red below 750 ms.
- Unit tests cover perpendicular contact, timing misses, parallel-lane clearance, immediate
  overlap, deterministic selection, crossing awareness, and rear ownership.
- The one-minute 23-car dense soak uses catalog OBBs and enforces circulation, completed
  traversals, queue depth, junction exclusivity, maximum simultaneous overlaps, and total
  overlap pair-ticks.
- Trace result at the checkpoint: 22/23 cars circulated, 129 junction traversals completed,
  maximum queue position 5, maximum concurrent overlapping pairs 1, and 27 overlap pair-ticks.

## Netcode Boundary

Predictive traffic contact is district-server AI policy. It selects desired speed before the
existing authoritative movement step. It does not mutate shared vehicle stepping, dynamic
contact, interaction-island selection/replay, local prediction, reconciliation, remote
interpolation, combat rewind, AOI, or rollout code. Clients receive only resulting physical
state and opt-in debug diagnostics.

## Remaining Work

- G2b.2b: movement-class conflict matrices so compatible authored turns can share a junction
  without weakening exclusive conflicts.
- G2c: authored lane changes, queue-aware passing, strongly connected wait-graph detection,
  deterministic deadlock victim selection, and safe population reseeding fallback.
- Later: acceleration-aware prediction and curved swept volumes if measured traffic speeds
  exceed the current short-horizon constant-velocity approximation.

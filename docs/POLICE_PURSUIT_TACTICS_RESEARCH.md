# Police Pursuit Tactics Research

Date: 2026-07-18

Status: G3a implementation contract

## Scope

This note defines the first coordinated police-tactics slice for NOCK0. It projects the
finite response leases delivered in G1 into stable primary, containment, support, and
intercept responsibilities for existing foot officers and cruisers.

Pinned educational references:

- re3 commit [`3233ffe1c4b99e8efb4c41c6794b4fce880cf503`](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)
- reVC commit [`b9eeb33efcd04a5b7a423921609baef11bf4719a`](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a)

The implementation is original TypeScript. No source code, enums, constants, data layouts,
or tuning tables are copied.

## Source-Derived Behavior

### Pursuit membership is finite, explicit ownership

Both references register officers in bounded pursuit slots, release those slots on state
changes, audit the active list, and permit a better-positioned officer to replace a poor
assignment:

- [re3 pursuit registration and release](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L142-L223)
- [re3 replacement behavior](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L336-L373)
- [re3 pursuit-list audit](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Wanted.cpp#L370-L420)
- [reVC pursuit registration and release](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L156-L241)
- [reVC replacement behavior](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L372-L407)
- [reVC pursuit-list audit](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Wanted.cpp#L399-L454)

This supports a strict ownership chain: wanted policy declares demand, the district
allocator owns unit leases, and tactical behavior consumes those leases. Tactical logic
must not create an officer, steal a response slot, or silently maintain a second roster.

### High-level mission, local action, and physical movement remain separate

The traffic references retain persistent mission/style/path state while temporary driving
actions and low-level control execute separately:

- [re3 autopilot mission/action/path state](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/AutoPilot.h#L8-L90)
- [reVC expanded mission set and preserved layered runtime](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/AutoPilot.h#L8-L97)

Police pedestrians likewise consume pursuit membership and target facts through the
ordinary pedestrian objective/action machinery instead of moving directly from wanted
policy. The transferable production pattern is the separation of assignment, tactical
intent, navigation, locomotion, and outcomes.

### Response limits and roadblock pressure are policy, not arbitrary spawns

Wanted level publishes pursuer, law-enforcement vehicle, and roadblock limits rather than
directly manufacturing a unit at the suspect position:

- [re3 wanted response limits](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Wanted.cpp#L284-L336)
- [reVC wanted response limits](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Wanted.cpp#L311-L365)
- [re3 authored roadblock activation](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/RoadBlocks.cpp)
- [reVC authored roadblock activation](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/RoadBlocks.cpp)

G3a does not instantiate roadblocks. It establishes the stable tactical ownership needed
before a later roadblock or stinger system can reserve authored opportunities safely.

## Clean-Room Adaptation

The references do not expose a reusable multiplayer squad-role planner. NOCK0 therefore
adds an original `PursuitCoordinator` with a narrow responsibility:

```text
wanted demand
  -> response allocator owns finite unit leases
  -> pursuit memory owns each unit's private last-known facts
  -> pursuit coordinator projects stable role and goal
  -> pedestrian/cruiser controllers navigate and act
  -> combat/arrest/damage systems decide outcomes
```

### Stable role projection

For each suspect and unit kind, roles are finite and ordered:

- foot: primary, contain-left, contain-right, support-left, support-right;
- cruiser: primary, intercept-left, intercept-right.

An existing role is retained while its allocator lease remains valid. Vacated roles are
filled by assignment age, distance, and stable unit ID. Distance changes alone cannot
reshuffle a live group every tick. If a primary lease disappears, the oldest eligible
remaining assignment deterministically takes the free primary role.

### Role-relative goals

Visible-suspect goals are derived from the suspect's authoritative heading:

- primary uses the live or predicted target point;
- containment uses lateral offsets;
- support trails and widens behind the target;
- cruiser intercept advances and flanks the target.

When visibility is lost, every role searches its own `PursuitMemory` last-known point.
Tactical goals do not grant line of sight, identity, road occupancy, or collision bypass.
Pedestrian navigation and cruiser route planning remain responsible for finding a legal
path to the goal.

### Execution rules in this slice

- Only the primary foot officer may initiate the existing point-blank melee behavior.
- Containment officers hold their offset instead of converging onto the same contact point.
- Secondary cruisers intercept or contain; they never inherit the primary high-heat ram
  strategy.
- Primary cruiser behavior retains the existing search, pursuit, intercept, and heat-3
  occupied-vehicle ram policy.
- The coordinator records observe, search, pursue, intercept, contain, arrest, and
  disengage phases, but G3a does not yet produce an arrest outcome.

## Multiplayer Contract

Police tactics are server-only gameplay decisions.

- Clients do not predict, replay, submit, or arbitrate roles, phases, target identity,
  last-known facts, line of sight, or tactical goals.
- Only ordinary authoritative actor poses and action state replicate through the existing
  AOI path.
- A physical police actor may enter an interaction island using the same collider and
  contact rules as any existing actor. Promotion does not transfer AI authority.
- Tactical debug data is opt-in developer telemetry and never simulation input.
- Prediction, reconciliation, interpolation, combat rewind, AOI admission, island
  selection/replay, rollout, and shared movement/contact kernels remain unchanged.

## Diagnostics

F3 now exposes role counts and tactic goal lines:

- red: primary pursuit;
- amber: containment;
- blue: intercept;
- purple: search;
- gray: disengage.

Unresolved `observe` entries are counted but not drawn, preventing a transient line to an
unset world goal. Debug snapshots deep-copy tactics so later server mutation cannot rewrite
an already-published frame.

## Acceptance Evidence

G3a requires deterministic tests proving:

- assignment insertion order does not change role ownership;
- distance changes do not churn retained roles;
- removal of a primary lease promotes one deterministic replacement;
- role goals rotate with target heading;
- lost units search last-known positions;
- secondary cruisers cannot ram;
- containment officers do not pile into point-blank melee;
- debug snapshots and panel summaries expose server-owned tactics;
- complete project, netcode, soak, build, and frozen-kernel gates remain green.

## Deferred G3 Work

- surrender, restraint, arrest, transport, jail, and release outcomes;
- officer suitability beyond current allocator eligibility;
- authored roadblock and stinger opportunities;
- officer vehicle exit and re-entry behavior;
- force/escalation policy and crossfire-safe firing sectors;
- disabled-cruiser replacement and reinforcement staging presentation;
- pursuit pins integrated with future district transfer and persistence.

# Crime, Wanted, and Police Response Budget Research

Date: 2026-07-14

Status: G1 implementation contract

## Scope

This note defines NOCK0's server-authoritative path from a witnessed crime to a bounded
police response. It is an original TypeScript design informed by behavior visible in the
pinned educational reference sources. No reference code is copied.

Pinned references:

- re3 commit [`3233ffe1c4b99e8efb4c41c6794b4fce880cf503`](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)
- reVC commit [`b9eeb33efcd04a5b7a423921609baef11bf4719a`](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a)

## Source-Derived Behavior

### Wanted pressure publishes limits; it does not own every responder

Both games keep crime pressure, wanted level, current pursuit count, maximum pursuers,
maximum law-enforcement vehicles, and roadblock pressure together in the wanted record.
The wanted-level update translates pressure into response limits instead of directly
creating arbitrary officers:

- [re3 `Wanted.h`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Wanted.h#L8-L27)
- [re3 `Wanted.cpp`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Wanted.cpp#L284-L336)
- [reVC `Wanted.h`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Wanted.h#L9-L31)
- [reVC `Wanted.cpp`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Wanted.cpp#L311-L365)

The exact thresholds differ between the games. The durable pattern is the separation of
pressure, policy limits, active assignments, and population admission.

### Pursuit slots have explicit ownership and repair

An officer enters a bounded pursuit slot, increments the active count, and releases the
slot when leaving pursuit. The wanted update audits the list and count for consistency:

- [re3 pursuit registration and release](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L142-L223)
- [re3 pursuit-list audit](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Wanted.cpp#L370-L420)
- [reVC pursuit registration and release](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L156-L241)
- [reVC pursuit-list audit](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Wanted.cpp#L399-L454)

NOCK0 needs the same ownership invariant across multiple simultaneous suspects: one
response unit has at most one assignment, every assignment names one eligible suspect,
and aggregate counts are derived from the assignment registry rather than maintained by
unrelated counters.

### Better-positioned units can replace poor assignments

Nearby unassigned officers are allowed to replace a farther pursuer once the response is
at its cap. Officers beyond a useful distance can also be removed when the cap contracts:

- [re3 replacement behavior](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L336-L373)
- [reVC replacement behavior](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L372-L407)

The original single-player code can make this decision locally per officer. NOCK0 must
make it once on the district server, with deterministic ordering, lease hysteresis, and a
material score advantage before replacement so networked clients see stable ownership.

### Population admission is separate from pursuit assignment

Police vehicles participate in a global count. Spawning also checks overall vehicle
capacity, wanted limits, time since the previous reinforcement, visibility, distance,
route placement, and collision clearance:

- [reVC law-enforcement vehicle admission](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L134-L166)
- [reVC spawn validation and registration](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L591-L669)
- [reVC pedestrian population pressure](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/Population.cpp#L521-L553)
- [reVC law-enforcer count ownership](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/vehicles/Vehicle.cpp#L1772-L1785)

NOCK0 therefore keeps three separate responsibilities:

1. wanted policy declares per-suspect demand;
2. response allocation assigns existing finite units;
3. fleet/population controllers decide whether and where additional units may activate.

## Current NOCK0 Gap

The current path already supports incident deduplication, witnesses, delayed reports,
wanted heat, foot pursuit memory, cruiser pursuit memory, and response-vehicle spawning.
However, capacity is split between three unrelated owners:

- `DispatchSystem` independently assigns foot officers;
- `PoliceVehicleDispatchSystem` independently assigns cruisers;
- `PoliceResponseFleetController` sizes the fleet from only the highest-wanted player.

Consequences:

- two wanted players do not share one explicit district budget;
- foot and cruiser assignment counts cannot be audited together;
- the fleet cannot see aggregate demand or assignment deficits;
- cruiser search expiry is private to the vehicle controller;
- insertion order can influence which unit becomes useful even when better units exist;
- there is no single debug view for demand, assignments, releases, or overflow.

## NOCK0 Response Model

### Authoritative input

The allocator receives immutable snapshots once per server simulation tick:

- identified suspects with wanted level, report revision, report position, and current
  authoritative position;
- eligible foot officers and cruisers with authoritative position and availability;
- current server time.

An unwitnessed crime does not identify a suspect and cannot enter the allocator. A newer
report revision can reactivate a unit-suspect pair whose previous search expired.

### Original district policy

These are NOCK0 tuning values, not copied reference tables:

| Wanted | Foot cap | Cruiser cap |
|---:|---:|---:|
| 0 | 0 | 0 |
| 1 | 1 | 0 |
| 2 | 2 | 1 |
| 3 | 4 | 2 |
| 4 | 5 | 2 |
| 5+ | 5 | 3 |

The first district supports at most five assigned foot officers and three assigned
cruisers. Foot officers cost one response point, cruisers cost two, and the district has
an eleven-point ceiling. Policy constants live with the allocator, not in the room or AI
controllers.

The July 18 playtest pass intentionally reserves the first cruiser and firearm response
for level two. Level one is one arrest/melee-capable foot officer. Level two introduces a
bounded pair of foot officers and one cruiser; level three is the first coordinated swarm
tier. Heat bands are `20 / 55 / 120 / 200 / 300`, with original per-crime pressure values,
so one serious police casualty reaches level two rather than immediately entering the
roadblock/swarm tier.

### Deterministic fairness

For each unit kind, the allocator computes target quotas before choosing units:

1. cap capacity by available units, the district kind limit, and response points;
2. give underserved suspects coverage before adding depth to an already covered suspect;
3. break equal coverage by higher wanted level and then stable suspect ID;
4. retain valid assignments up to each quota;
5. fill deficits with the closest eligible unit, then stable unit ID.

This permits a high-wanted suspect to receive a deeper response without starving a second
identified suspect.

### Stability and replacement

- Assignments are leases with their original assignment time.
- Invalid units, cleared suspects, and superseded report suppressions release immediately.
- A quota rebalance waits for a short minimum lease unless a safety invariant would be
  violated.
- A free unit replaces a retained same-kind unit only when the distance improvement is
  material.
- Two assignments may swap suspects only when the total distance improvement is material.
- Released units observe a short reassignment cooldown.
- Search expiry suppresses only that unit/report pair; a newer report is eligible.

All comparisons use deterministic IDs after numerical score comparisons. Repeating an
update with identical input must produce no changes.

### Search and clearing

Assignment ownership and search memory stay distinct:

- allocation answers *who owns this response slot*;
- `PursuitMemory` answers *where that unit last observed its suspect*;
- foot and cruiser behavior answer *how the unit moves and acts*.

When visibility is lost, a unit retains its assignment while searching. Expired search
releases/suppresses the unit-report pair. Clearing a suspect atomically removes incidents,
wanted state, reports, assignments, and pursuit memory.

## Multiplayer Adaptation Contract

G1 is server-only gameplay. It does not modify multiplayer simulation behavior.

- Crime, wanted, identification, response allocation, pursuit memory, fleet admission,
  AI strategy, and search expiry execute only in the authoritative district simulation.
- Clients do not predict or replay any of those decisions.
- The allocator may read authoritative positions for scoring, but writes no movement.
- Existing actor poses continue through ordinary AOI replication.
- Existing local movement/contact prediction may include a promoted physical police actor
  exactly as before; promotion does not transfer its AI or assignment authority.
- No changes are permitted to prediction, reconciliation, interpolation, AOI admission,
  island selection/replay, combat rewind, rollout, or shared movement/contact kernels.

If G1 reveals a genuine transport or prediction requirement, implementation stops and a
separate multiplayer adaptation contract is required.

## Acceptance Evidence

G1 is complete only when tests and live diagnostics prove:

- two simultaneous wanted players share finite foot and cruiser pools;
- no unit has duplicate or cross-kind assignment ownership;
- repeated identical updates create no assignment churn;
- input insertion order does not change final assignments;
- wanted escalation/contraction changes quotas without oscillation;
- dead officers, destroyed/hijacked cruisers, and cleared suspects release immediately;
- materially closer units replace distant units after hysteresis;
- search expiry suppresses an old report but a newer report can reassign the unit;
- fleet demand is aggregate and bounded instead of selecting only one suspect;
- F3 diagnostics expose demand, budget use, assignments, changes, and suppressions;
- permanent netcode regression and impairment-soak gates remain unchanged and pass.

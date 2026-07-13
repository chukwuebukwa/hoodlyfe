# Police Response Fleet Research

Updated: 2026-07-11

## Production Reference

The pinned Vice City source separates response population from individual vehicle driving:

- `Wanted.cpp` derives explicit maximum law-enforcement vehicles and officers from wanted level.
- `CarCtrl.cpp` admits police cars through the global vehicle budget, applies wanted-level spawn delays, rejects occupied spawn space, requires a reachable road path, and avoids visibly creating cars too close to the player.
- Spawned response cars receive police occupants and a police mission, while `CarAI`/`CarCtrl` separately choose pursuit speed, avoidance style, interception, blocking, and officer exit behavior.
- Law-enforcement vehicles are counted and released independently from ordinary random traffic.

The useful lesson is the ownership boundary, not the original constants. Multiplayer response population must remain server-authoritative, bounded per room, and independent from rendering or any one suspect's client.

## NOCK0 Translation

`PoliceResponseFleetController` owns only response-car population:

- desired fleet size is bounded to one, two, or three available units by the highest active street heat;
- the existing authored cruiser satisfies the first unit before dynamic cars are requested;
- reinforcements arrive one at a time with faster cadence at higher heat;
- candidate spawns must be on occupiable road space, clear of vehicles and players, within a bounded response annulus, and connected to the suspect by the bounded road planner;
- dynamic units register with the existing `PoliceVehicleController`, which continues to own assignment, search, pursuit, interception, ramming, and driving;
- response cars enter the existing hijack lifecycle. Once stolen or destroyed, fleet ownership and police control are released without deleting the player's vehicle or wreck;
- surplus dynamic cars receive a stand-down deadline and disappear only when healthy, unoccupied, and clear of street players. Authored, occupied, stolen, and destroyed cars are never removed by this controller.

The room adapter contains construction, callbacks, diagnostics, and one fixed-step update call only. Population policy does not move back into `DistrictRoom`.

## Current Limits

- The compatibility road mask can prove road connectivity, but it cannot author legal lanes, turn connectors, shoulders, or roadblock slots.
- Units independently consume the existing dispatch response cap. Coordinated intercept sectors and roadblocks require authored lane metadata to avoid arbitrary blocking.
- Police occupants remain abstract. Visible officer exit, arrest, and containment behavior need their own actor lifecycle.
- Fleet state is room-local. Cross-district dispatch and durable impound ownership belong to later world/session services.

## QA Gate

- Heat 1/2/3 produces at most 1/2/3 available units.
- Reinforcements respect cadence and never overlap current actors at creation.
- Every dynamic spawn has a complete bounded road route to the target.
- Hijacked and destroyed response cars leave police ownership without deletion.
- Heat loss removes only safe fleet-managed surplus after the grace period.
- Debug snapshots expose desired, available, managed, and next-spawn fleet facts.

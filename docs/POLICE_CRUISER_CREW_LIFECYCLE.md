# Police cruiser crew lifecycle

The implementation follows the behavior split used by GTA III's `re3` codebase while
adapting it to this game's authoritative response-allocation system.

## Reference behavior

- `CarAI.cpp` stops a nearby law-enforcement vehicle and tells all occupants to leave
  when the player is on foot, or after the player's vehicle has remained stopped.
- `CarCtrl.h` defines that stopped-vehicle wait as 2,500 ms.
- `CopPed.cpp` retains the officer's original vehicle while the officer is pursuing.
- When pursuit clears, `CopPed.cpp` assigns the officer an enter-car-as-driver objective.
- `PedAI.cpp` converts an on-foot kill objective held by a cop in a vehicle into a
  leave-car objective.

Pinned reference revision:
`hottabxp/re3@3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

## Local lifecycle

1. A cruiser with direct sight stops within 150 world units.
2. An on-foot suspect causes an immediate dismount. A suspect in a stopped vehicle
   must remain below 18 speed for 2,500 ms.
3. One two-officer crew may be active per suspect.
4. The parked cruiser is removed from driving and response allocation, while its two
   officers replace its response lease and pursue on foot.
5. Each crew keeps its `vehicleId`; the vehicle remains authoritative and reserved.
6. When the suspect dies, leaves the street, or loses all wanted level, both surviving
   officers receive a return-to-car movement command.
7. Once the crew reaches the cruiser, the temporary officer actors are removed and the
   original cruiser resumes AI service.
8. If the cruiser is destroyed, hijacked, or occupied before the crew returns, its
   ownership link is abandoned and the officers remain ordinary district police.

## Ownership boundaries

- `PoliceVehicleController` decides *when* a dismount is tactically valid.
- `PoliceResponseFleetController` owns the cruiser/crew lifecycle.
- `PoliceResponseAllocationSystem` atomically replaces the cruiser lease with nearby
  foot-officer leases.
- `PedestrianController` owns the explicit return-to-car movement command.

This separation avoids hidden occupants in `VehicleState`, prevents duplicate response
actors, and keeps the behavior deterministic on the server.

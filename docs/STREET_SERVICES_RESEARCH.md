# Street Services and Interaction Research

Date: 2026-07-10

Primary gameplay reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference treats a service as a world-owned state machine with explicit eligibility, payment, effect, and release phases.

- Pay-and-spray garages require the full vehicle to be inside, reject unsupported or obstructed vehicles, close before work begins, repair health and component state, clear fire, apply wanted/color policy, then reopen.
- Shop pickups validate funds before granting inventory and retain independent world availability/respawn state.
- Garage control is separate from automobile damage ownership: the garage requests restoration but does not reproduce vehicle damage formulas.
- Player interaction uses contextual priorities so one input cannot simultaneously trigger a service and vehicle access.

References:

- [`Garages.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Garages.cpp)
- [`Pickups.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Pickups.cpp)
- [GTA2 PC manual](https://gtamp.com/GTA2/gta2manual.pdf)

NOCK0 borrows ownership and validation ideas, not code, formulas, prices, layouts, or identifiers.

## Implemented Ownership

- `shared/content/street-services.ts` owns immutable capacities, interaction radii, and pure bounded quote policy.
- `StreetServiceController` owns authoritative service placement, proximity, eligibility, payment requests, failure notices, and effect dispatch.
- `StreetEconomyController` remains the only owner that changes cash.
- `VehicleSimulationController.repair` owns complete vehicle restoration; `FireControlController.restock` owns ammunition restoration.
- `PlayerInteractionController` gives a valid service first refusal, then delegates to vehicle access, and suppresses repeated interaction messages in the same simulation tick.
- `InteractionPresentationController` projects the same shared quotes into world markers, minimap points, desktop action text, touch text, and accessible labels. It never performs a purchase locally.
- `game.notice` is now the generic transient-notice protocol for missions and services rather than a mission-owned transport name.

`DistrictRoom` only wires these ports, initializes replicated service state, and forwards the validated `interact` command.

## Current Service Rules

### Ammunition Counter

- Player must be alive, on foot, outside another timed action, inside the counter radius, and missing ammunition.
- Price is based on missing reserves with weapon-specific weights and a $25-$500 bound.
- Successful debit restores pistol, SMG, and shotgun reserves to current capacities.
- A fully stocked player falls through to another contextual interaction instead of paying $0.

### Repair Garage

- Player must be the driver of a damaged vehicle inside the garage radius.
- Wanted players, burning/destroyed vehicles, and vehicles moving faster than the service threshold are rejected without a debit or effect.
- Price incorporates missing health, four body-damage components, and engine damage with a $60-$700 bound.
- Successful debit restores health and all mechanical/body/fire fields through vehicle-domain code.
- A healthy vehicle falls through to `EXIT CAR` rather than presenting a repair action.

## Consistency and Durability

The current transaction key includes service, player, vehicle where applicable, and authoritative simulation tick. Same-tick network duplicates are consumed by the interaction controller. After success, restored state makes a later tick ineligible, preventing a second charge for the same need.

This is atomic at the current single-threaded room-command level: validation and debit complete before one synchronous domain effect. It is not a durable database transaction. The persistence replacement must apply ledger entry and inventory/vehicle ownership mutation transactionally, preserve globally durable idempotency, and reconcile effects after process failure. No chain call belongs in this path.

## Deferred Production Nuance

- Timed garage closing/work/reopening with explicit player control lock and interruption policy.
- Full oriented vehicle-footprint containment rather than center-radius proximity.
- Garage obstruction, service queueing, vehicle class restrictions, repair history, and insurance/impound rules.
- Individual ammunition purchases, weapon pickups, reload magazines, inventory capacity, and shop availability/respawn.
- Hospital and clothing services through the same interaction and economy ports.
- Notice throttling and private purchase result messages under hostile input rates.
- Authored service locations and interiors in the original city map.

## Acceptance Coverage

- Two services initialize exactly once at collision-safe deterministic points and replicate to real clients.
- Shared quote policy handles full state, minimum charge, layered damage, and maximum bounds.
- Successful repair/restock applies one debit and one complete effect.
- Wanted repair rejection preserves both cash and vehicle damage.
- Valid services take priority over vehicle entry/exit; same-tick duplicate input does nothing.
- Client action labels and minimap points derive from authoritative state and shared quote policy.
- Full 98-test suite and production build pass, including the real two-client room scenario.
- Live browser QA renders the ammunition marker and minimap shop point with no new console error after a clean reload.

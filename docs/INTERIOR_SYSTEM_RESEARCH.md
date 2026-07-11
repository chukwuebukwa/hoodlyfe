# Seamless Interior System

## Current Vertical Slice

Mercy Hospital is the first same-building, single-floor production slice. Its doorway is attached to the south facade of the large building above the `SLOW` road marking. Walking into the threshold changes authoritative `PlayerState.spaceId` from `street` to `mercy-hospital`; walking through the inside threshold returns to collision-safe street ground. There is no room reconnect, loading screen, or teleport message.

The OpenGTA2 exporter owns the exact 32-triangle roof-lid group. The browser hides only `roof:mercy-hospital`, then renders a hospital floor, beds, waiting bench, reception desk, recovery marker, treatment service, walls, and doorway in the same XY footprint. Neighboring geometry remains visible and depth-tested.

Mercy is also a real medical destination. `MedicalCareController` selects the nearest facility and returns a respawn plan containing coordinates plus `spaceId`; `PlayerLifecycleController` applies that plan. Mercy respawns inside at its recovery anchor, while Southside Clinic remains a street fallback. Threads is a separate street service until it receives its own authored building.

## System Boundaries

- `shared/content/interior-catalog.ts`: finite IDs, kind, floor height, building footprint, facade threshold, entry/exit pose, fixture collision, recovery anchors, and service anchors.
- `server/game/interiors/interior-controller.ts`: entry, exit, interior movement, wall collision, and fixture collision.
- `server/game/medical/medical-care-controller.ts`: facility registration, nearest-facility selection, pricing, admissions, and recovery destination.
- `server/game/players/player-lifecycle-controller.ts`: death/respawn mutation and application of the selected medical plan.
- `PlayerState.spaceId` and `StreetServiceState.spaceId`: authoritative spatial membership; durable property ownership does not belong here.
- `DistrictReplicationController`: exact same-space player/service membership and street-only collection ownership through Colyseus `StateView`.
- OpenGTA2 `WebAssetExporter`: authored source-map occluder bounds and stable roof index groups.
- `three-interior-renderer.ts`: floor, walls, fixtures, facade sign/awning, and door presentation only.

`DistrictRoom` remains composition and message routing. No building-specific gameplay rule belongs there.

## Roof Rule

Do not infer roofs from player radius, footprint, or height at runtime. Rejected prototypes produced rectangular popping, black holes, noisy transparency, and disappearing neighboring geometry.

The accepted contract is:

1. OpenGTA2 source-map bounds and lid-normal filtering select exact roof triangles offline.
2. Export version 2 separates permanent base indices from named occluder indices without changing index order.
3. The shared catalog and payload must agree on ID, door coordinates, and floor Z.
4. Entering one interior hides only the matching named group.
5. A valid floor and closed interior shell must already exist beneath it.

`test/three-prototype-interior-contract.test.ts` now fails locally when stale generated assets use a different interior ID.

## QA Contract

- Controller tests cover entry, exit, wall collision, fixtures, service-space isolation, nearest medical selection, recovery anchors, and lifecycle application.
- The real two-client scenario covers death, indoor respawn, same-space isolation, exit, restored street visibility, continued combat, and an explicit hospital round trip.
- `?renderer=three&qa=1` sends ordinary movement toward real thresholds; it exposes no server teleport command.
- Live desktop QA completed street -> `mercy-hospital` -> street and showed the facade sign, exact roof cutaway, clinic fixtures, same-space treatment marker, player, and surrounding city.
- Explicit `390 x 844` QA produced a nonblank `390 x 844` canvas with zero document overflow.
- Wire behavior remains `street: players/NPCs/vehicles/services` versus `hospital: same-space players plus hospital-mercy only`.

## Next Production Steps

1. Give Threads a separate authored building using `INTERIOR_AUTHORING_GUIDE.md`.
2. Add interior projectile/world collision before enabling weapons indoors.
3. Add interior NPC destinations and perception ownership before spawning patients, staff, or police indoors.
4. Add a garage only after vehicle portal width, occupancy, storage record, and spawn clearance are authored.
5. Add multi-floor `surfaceId` only after multiple one-floor interiors pass the same contract.

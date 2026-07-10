# Seamless Interior System

## Current Vertical Slice

Threads Showroom is the first same-building, single-floor interior. The exterior door is authored on the east wall of the building beside spawn. Walking into its threshold changes the authoritative player `spaceId` from `street` to `threads-showroom`; walking through the inside threshold returns the player to the street. Entry and exit require no interact button, room reconnect, loading screen, or QA teleport command. The ordinary interaction control is reserved for the Threads service inside.

The showroom uses the building's existing XY footprint. Its floor presentation covers the exterior lid while the player is inside, and its walls, counter, racks, and displays use Three geometry. The surrounding city remains visible. The server owns interior bounds and fixture collision, resolves movement per axis, and replicates only the player's space identity.

## System Boundaries

- `shared/content/interior-catalog.ts`: finite interior IDs, labels, floor height, building footprint, door thresholds, entry pose, fixture collision, and interior-owned service anchors.
- `server/game/interiors/interior-controller.ts`: entry, exit, interior movement, wall collision, and fixture collision.
- `PlayerState.spaceId`: replicated spatial membership. Durable property ownership does not belong here.
- `StreetServiceState.spaceId`: authoritative service membership. Service execution and client affordances require an exact player/service space match.
- `three-interior-renderer.ts`: visual floor/walls/fixtures and exterior door presentation only.
- Street combat, traffic, vehicles, missions, pickups, and minimap remain suppressed indoors. Same-space services and players are explicitly projected; other entities never gain implicit interior access.

## Roof Rule

Do not infer roofs from height at runtime. Two rejected prototypes demonstrated why:

1. CPU triangle removal by moving tile radius produced rectangular popping and black holes.
2. Fragment dithering of every surface above the player produced noisy transparency and exposed missing geometry.

The exporter must assign an `occluderGroupId` to authored roof triangles and link that group to an `interiorId`. Entering an interior hides only that fixed group. A valid interior floor must exist below it before the roof can hide. Exterior walls remain depth-tested and visible.

## Next Production Steps

1. Export roof group and doorway anchors for Threads Showroom.
2. Filter private/state-view replication by `spaceId` rather than sending every entity and hiding it client-side.
3. Add interior projectile/world collision before enabling weapons indoors.
4. Add interior NPC destinations and perception ownership before spawning pedestrians or police indoors.
5. Add a garage interior only after vehicle portal width, occupancy, storage record, and spawn clearance are authored.
6. Add multi-floor `surfaceId` only after one-floor transitions and roof ownership are stable.

## QA Contract

- Focused controller tests cover entry, exit, wall collision, and fixture collision.
- `?renderer=three&qa=1` adds a development-only browser driver that sends ordinary movement input toward the real thresholds.
- Browser QA completed a street `(2080,2080)` -> showroom `(2120,2112)` -> street `(2231,2112)` round trip.
- Browser QA also opened the server-authoritative Threads wardrobe inside and proved that the same coordinates on `street` expose neither its marker nor interaction.
- Desktop and `390 x 844` mobile views showed the same building footprint, no page overflow, hidden exterior-only UI, and a full-size Three canvas.
- Mobile screenshot pixel analysis found 18,463 unique center-crop colors, channel standard deviations above 45, and `0.07%` near-black pixels, rejecting blank/void output.

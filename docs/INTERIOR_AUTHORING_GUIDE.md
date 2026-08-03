# Interior Authoring Guide

The data-driven district-wide replacement for building-specific authoring is defined in
[`SEAMLESS_BUILDING_SYSTEM_SPEC.md`](SEAMLESS_BUILDING_SYSTEM_SPEC.md).

This is the shortest safe path for adding another seamless, single-floor interior to the game client. An interior is not a teleport-only room: one stable ID must join authoritative movement, service ownership, replication, exported roof geometry, presentation, and QA.

## Ownership Map

| Concern | Owner |
| --- | --- |
| Roof groups and seamless bounds, doorway, floor, reveal areas and fixtures | `shared/content/buildings/buildings.json` |
| Teleport-room entry, exit, fixtures, recovery/service anchors | `shared/content/interior-catalog.ts` |
| Entry, exit, wall and fixture collision | `server/game/interiors/interior-controller.ts` |
| Medical facility selection and recovery destination | `server/game/medical/medical-care-controller.ts` |
| Service placement and interaction | the relevant domain controller, never `DistrictRoom` |
| Same-space network visibility | `server/game/replication/district-replication-controller.ts` |
| Exact removable roof triangles | OpenGTA2 `WebAssetExporter`, compiled from the shared building manifest |
| Interior shell, fixtures, doorway and facade sign | `src/game/presentation/interiors.ts` |
| Permanent GTA-style exterior minimap blip | `storefrontMinimapPoints` plus transparent sprites in `public/assets/custom/minimap/` |

`DistrictRoom` should only construct these owners and route messages. Do not add building-specific gameplay methods there.

## Coordinate Systems

1. OpenGTA2 source map coordinates use GTA block units.
2. The exported geometry manifest stores source-level block coordinates and each geometry
   chunk stores chunk-local vertices.
3. Server and browser gameplay use pixels, with `64 px` per block.

The complete active `bil` world has origin `(0, 0)`. The stable authoring reference remains
the former `(96, 97)` crop, so content helpers perform the translation. Mercy Hospital's
source-level conversion is:

```text
source door:       (137.125, 127.375)
runtime door:      (8776, 8152) px
runtime floor Z:   2.0625 * 64 = 132 px
```

Always read the generated origin instead of assuming it when a crop or level changes.

## Add A Building

1. Inspect the location in the source map and game client. Record the complete roof footprint, a facade with open street space, and collision-safe exterior approach.
2. Add one entry to `shared/content/buildings/buildings.json` with a permanent kebab-case `id`. Define its source-level shell bounds, cutaway mode, expected triangle count, floor, entrance, and mode.
3. For a seamless building, author `bounds`, every connected `footprint`, doorway `floorConnectors`, player-driven `revealAreas`, optional `signage`, and all collision/render `obstacles` in source block units. The shared compiler converts them to runtime pixels for the browser and server. QA teleport destinations are generated from these manifest entries automatically.
4. For a legacy teleport room, add its gameplay layout and service anchors to `shared/content/interior-catalog.ts` using the same stable ID.
5. Keep every anchor outside fixture obstacles. Entry must be inside the shell; `exitX/exitY` must be on collision-safe street ground.
6. Build and run the exporter. It reads the same manifest and fails if a roof group no longer matches `expectedTriangleCount`. Never hand-select triangles in browser code.

```bash
dotnet test src/OpenGta2.GameData.UnitTests/OpenGta2.GameData.UnitTests.csproj
OPENGTA2_PATH=/path/to/GTA2/App_Executables npm run assets:export-buildings
```

7. Confirm `geometry/world.json` contains the occluder definition and that its triangle total is
   distributed across the relevant chunk payloads. The ID, door, floor height, and triangle
   count must match the catalog. `test/map-interior-contract.test.ts` enforces this locally.
8. Add a renderer fixture function for a new interior `kind`. Geometry dimensions must match manifest obstacles exactly enough that visible furniture and server collision agree.
9. Register domain content through `serviceAnchors` or `recoveryAnchor`. A service's `spaceId` must equal the interior ID. A medical respawn plan must return both coordinates and `spaceId`.
10. Project a permanent exterior-door minimap blip with a recognizable kind-specific icon. The blip belongs to the storefront catalog, not indoor service replication, so it remains visible from the street even though its service is inside.
   - Use a `64 x 64` transparent RGBA PNG under `public/assets/custom/minimap/`.
   - Keep the subject centered, text-free, and legible at a rendered size of `30 x 30` pixels.
   - Preserve the shared chunky black outline and one kind color: ammunition gold, clothing pink, medical mint, repair cyan.
   - Register new location kinds in `LOCATION_ICON_URLS`; retain a procedural fallback so late or failed image loads never produce a blank marker.
11. Do not replicate street NPCs, vehicles, missions, projectiles, or services into an interior. `StateView` should expose only same-space players and same-space services.

### Garage Doors

Garage buildings may define one automatic sectional door at their authored `entrance`:

```json
"garageDoor": {
  "height": 2.25,
  "thickness": 0.1875,
  "openRadius": 2.75,
  "animationMs": 700,
  "holdOpenMs": 1200
}
```

All dimensions are source block units except the millisecond durations. The shared catalog derives
the door's center, width, orientation, collision rectangle, and hinge from the entrance, so do not
author a second doorway position. The server opens for nearby living street players or occupied
vehicles, holds while the doorway is occupied, and reverses a closing door when any vehicle or player
enters the opening. Authoritative map and Rapier collision become passable together near the end of
the lift; the browser interpolates the same replicated timeline. Garage drafts generated by the
Builder Gun include these defaults automatically.

## Builder Gun Drafts

Already-authored seamless buildings highlight gold and cannot create a second overlapping draft. Reset the selection and target a different roof instead.

The local game exposes the first in-world building authoring pass at:

```text
/?qa=1&build=1
```

Press `G` or use **Equip** in the Builder Gun panel. While equipped, movement remains active but
primary clicks, reload, weapon cycling, contextual interactions, and combat fire are suppressed.

1. Aim at an elevated building roof and click to select its complete connected collision component.
2. Choose **Store** or **Garage**.
3. Click a highlighted facade. Stores require a 56 px opening and garages require a 160 px opening.
4. Inspect the footprint, facade, entrance, and generated fixture preview.
5. Use **Publish Interior**. The completed selection is released automatically, so another building
   can be targeted without resetting the tool. The generated ID is stable for that map footprint.
6. Wait for the success status. Local development writes the manifest, geometry manifest, and
   affected chunks atomically, then reloads. Hosted authoring asks for the configured editor
   username and password, publishes an immutable bucket delta, waits for the room-content cache,
   and reloads into a fresh room.

The offline CLI remains a recovery path for imported JSON and converter-level changes:

```bash
npm run buildings:publish -- ~/Downloads/building-draft.json \
  --id eastside-quick-mart \
  --label "Eastside Quick Mart"
```

The in-game publisher validates the draft and overlap contract, moves matching triangles from each
chunk's permanent indices into a named removable-roof group, updates the building and geometry
manifests, and rejects a selection that owns no geometry. It does not need the local GTA install
because it operates on the current exported map. The CLI re-runs the geometry-only GTA exporter and
is still required when source-map geometry itself changes. Add `--dry-run` to inspect a CLI import
without writing, or `--replace` to intentionally replace the authored building on that footprint.

Drafts are retained in local browser storage under `nock0.builder-gun-drafts-v1` until publication
succeeds. A draft has `status: "needs-export"` and a null expected triangle count; the server assigns
the exact count during publication. Production requests pass through Basic authentication and only
server-side code can write the private bucket. Credentials are kept in browser session storage for
the current tab and are never placed in world content or `NEXT_PUBLIC_*` variables.

Right-click or **Reset** clears the current selection and preview. Pressing `G` holsters the tool
without deleting the current draft. Local publication deliberately does not commit or push, and
neither path can judge whether the generated fixture layout looks good; inspect the doorway, walls,
floor connectors, service point, and vehicle clearance before publishing.

## Required QA

Run these before committing:

```bash
npx tsx --test \
  test/building-manifest.test.ts \
  test/interior-controller.test.ts \
  test/medical-care-controller.test.ts \
  test/district-replication-controller.test.ts \
  test/map-interior-contract.test.ts \
  test/multiplayer.integration.test.ts
npm test
npm run build
git diff --check
```

Browser QA must prove:

- the exterior doorway is attached to the intended facade and does not float in a road;
- the street minimap shows the building's permanent kind-specific icon at its exterior door;
- walking through it changes to the expected `spaceId` without a loading screen;
- only the named roof group disappears;
- the player, interior floor, walls, fixtures, service markers and labels remain visible;
- neighboring roofs and facades do not pop or vanish;
- fixture collision matches presentation and the exit returns to safe street ground;
- garage doors visibly lift, block movement while closed, become passable before fully open, remain
  open while occupied, and reverse instead of closing through a player or vehicle;
- a second street client cannot see interior players or interior services;
- desktop and mobile canvases are nonblank, full viewport, and overflow-free;
- a fresh reload produces no new browser errors.

For hospitals, additionally kill a real player, verify the selected facility returns an indoor `spaceId`, confirm spawn protection, then walk outside and resume the multiplayer scenario.

## Failure Signatures

- **Roof stays on after entry:** catalog ID and exported occluder ID differ, or stale assets are loaded.
- **Large holes or texture popping:** occluder bounds selected walls or neighboring roof triangles. Tighten XYZ bounds and lid-normal filtering in the exporter.
- **Player renders over a roof:** player `spaceId`, surface-height lookup, and roof visibility are not synchronized.
- **Door floats in pavement:** trigger coordinates were chosen without checking the actual facade. Move the full catalog/export contract, not only the mesh.
- **Visible furniture can be walked through:** renderer dimensions and authoritative obstacles disagree.
- **Respawned player is invisible to everyone:** the player correctly entered another space, but the client or test is still observing them through a street-only view.

## Definition Checklist

An interior is complete only when it has one stable ID, source-map roof bounds, runtime bounds, exterior facade, permanent minimap icon, entry and exit, collision obstacles, visual fixture geometry, service/recovery ownership, same-space replication, exporter contract coverage, round-trip browser QA, and a devlog entry.

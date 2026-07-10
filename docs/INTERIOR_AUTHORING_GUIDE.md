# Interior Authoring Guide

This is the shortest safe path for adding another seamless, single-floor interior to the Three renderer. An interior is not a teleport-only room: one stable ID must join authoritative movement, service ownership, replication, exported roof geometry, presentation, and QA.

## Ownership Map

| Concern | Owner |
| --- | --- |
| Building bounds, doorway, entry, exit, fixtures, recovery/service anchors | `shared/content/interior-catalog.ts` |
| Entry, exit, wall and fixture collision | `server/game/interiors/interior-controller.ts` |
| Medical facility selection and recovery destination | `server/game/medical/medical-care-controller.ts` |
| Service placement and interaction | the relevant domain controller, never `DistrictRoom` |
| Same-space network visibility | `server/game/replication/district-replication-controller.ts` |
| Exact removable roof triangles | OpenGTA2 `WebAssetExporter` authored occluder manifest |
| Interior shell, fixtures, doorway and facade sign | `src/game/three/three-interior-renderer.ts` |

`DistrictRoom` should only construct these owners and route messages. Do not add building-specific gameplay methods there.

## Coordinate Systems

1. OpenGTA2 source map coordinates use GTA block units.
2. The exported Three payload stores crop-local block coordinates.
3. Server and browser gameplay use pixels, with `64 px` per block.

For the current `bil` crop, the origin is `(96, 97)` blocks. Mercy Hospital demonstrates the conversion:

```text
source door:       (137.125, 127.375)
crop-local door:   (41.125, 30.375)
runtime door:      (2632, 1944) px
runtime floor Z:   2.0625 * 64 = 132 px
```

Always read the generated origin instead of assuming it when a crop or level changes.

## Add A Building

1. Inspect the same location in the 2D renderer and the Three renderer. Record the complete roof footprint, a facade with open street space, and collision-safe exterior approach.
2. Add one `InteriorDefinition` with a permanent kebab-case `id`. Define `kind`, `floorZ`, `bounds`, `exteriorDoor`, `entry`, `exitDoor`, `obstacles`, and any service or recovery anchors.
3. Keep every anchor outside fixture obstacles. Entry must be inside the shell; `exitX/exitY` must be on collision-safe street ground.
4. Add the same ID to `ThreeOccluders` in OpenGTA2 `WebAssetExporter.cs`. Author source-map XY bounds and a tight Z band that selects roof lids, not walls.
5. Build and run the exporter. Never hand-select triangles in browser code.

```bash
dotnet test src/OpenGta2.GameData.UnitTests/OpenGta2.GameData.UnitTests.csproj
dotnet run --project src/OpenGta2.WebExporter -- \
  /path/to/GTA2/App_Executables \
  /path/to/nock0-action/public/assets \
  bil 64
```

6. Confirm `prototype.json` contains a version-2 occluder whose ID, door, floor height, and triangle count match the catalog. `test/three-prototype-interior-contract.test.ts` enforces this locally.
7. Add a renderer fixture function for the interior `kind`. Geometry dimensions must match catalog obstacles exactly enough that visible furniture and server collision agree.
8. Register domain content through `serviceAnchors` or `recoveryAnchor`. A service's `spaceId` must equal the interior ID. A medical respawn plan must return both coordinates and `spaceId`.
9. Do not replicate street NPCs, vehicles, missions, projectiles, or services into an interior. `StateView` should expose only same-space players and same-space services.

## Required QA

Run these before committing:

```bash
npx tsx --test \
  test/interior-controller.test.ts \
  test/medical-care-controller.test.ts \
  test/district-replication-controller.test.ts \
  test/three-prototype-interior-contract.test.ts \
  test/multiplayer.integration.test.ts
npm test
npm run build
git diff --check
```

Browser QA must prove:

- the exterior doorway is attached to the intended facade and does not float in a road;
- walking through it changes to the expected `spaceId` without a loading screen;
- only the named roof group disappears;
- the player, interior floor, walls, fixtures, service markers and labels remain visible;
- neighboring roofs and facades do not pop or vanish;
- fixture collision matches presentation and the exit returns to safe street ground;
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

An interior is complete only when it has one stable ID, source-map roof bounds, runtime bounds, exterior facade, entry and exit, collision obstacles, visual fixture geometry, service/recovery ownership, same-space replication, exporter contract coverage, round-trip browser QA, and a devlog entry.

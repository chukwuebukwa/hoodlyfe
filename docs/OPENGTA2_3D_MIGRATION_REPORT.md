# OpenGTA2 Browser 3D Migration Report

## Objective

Restore the real three-dimensional GTA2 map presentation in the NOCK0 browser game while preserving the existing multiplayer, weapons, vehicles, NPCs, missions, and server authority.

Repositories:

- OpenGTA2: `/Users/jimmyjiggler/Documents/2026/opengta/opengta2`
- Browser game: `/Users/jimmyjiggler/Documents/2026/opengta/nock0-action`

## Implemented Prototype Status

The feature-flagged client is playable at `/?renderer=three` and the Phaser client remains available at `/`.

Delivered:

- Renderer-neutral geometry extraction in `OpenGta2.Geometry`, including the complete slope, diagonal, partial-block, UV, flip, shade, opaque, and alpha-tested cases from the existing OpenGTA2 client.
- Full `64 x 64` district export with 20,612 triangles, a complete 992-tile atlas, and a pedestrian-surface height grid.
- Stable alpha triangle ordering and export validation for triangular, in-range, bounded-edge geometry. This fixed the giant stretched polygons seen in the first browser pass.
- One explicit coordinate boundary: `(serverX, -serverY, blockZ * 64)`, plus authored `90-degree` sprite-forward corrections for pedestrians and vehicles.
- Three rendering for players, appearance variants, pedestrians, vehicle catalog frames, damage stages, held weapons, passengers, in-car names, bullets, grenades, explosions, pickups, signals, services, and mission objectives.
- Authoritative input, collision, aiming, shooting, weapon cycling, vehicle interaction, touch controls, HUD, minimap, missions, medical care, wardrobe, notices, animation, interpolation, camera following, and F3 diagnostics.
- One same-building Mercy Hospital interior with an automatic facade doorway, replicated `spaceId`, medical recovery anchor, interior collision, same-space filtering, exact authored roof removal, exterior UI suppression, and a same-coordinate Three clinic presentation.

The attempted generic CPU roof deletion and dithered height cutaway were both rejected during live QA. The implemented replacement is exporter-authored occluder metadata. Payload version 2 preserves permanent opaque/alpha base indices and emits named interior groups. Mercy Hospital owns 32 stable lid triangles selected from tight source-map XYZ bounds and lid-normal filtering. The browser validates ID, door, floor height, and triangle count before rendering and hides only the matching group.

## What OpenGTA2 Does

OpenGTA2 reads GTA2's compressed `256 x 256 x 8` block map. Every map position is a column containing zero or more blocks.

Each block can contain:

- A textured lid and four textured wall faces.
- Rotation and flipping per face.
- Pedestrian and bullet-wall flags.
- Ground type.
- 7-degree, 26-degree, and 45-degree slopes.
- Diagonal and partial blocks.
- Per-face shading.

`src/OpenGta2.Client/Levels/LevelProvider.cs` divides the map into `8 x 8` chunks and sends every block to `src/OpenGta2.Client/Levels/SlopeGenerator.cs`, which generates actual vertices and triangle indices.

The camera in `src/OpenGta2.Client/Camera.cs` is:

- Exactly vertical, not tilted.
- Perspective, not orthographic.
- `45-degree` FOV. The code comment claiming 90 degrees is incorrect.
- Therefore GTA2 is true 3D viewed from directly above, not conventional diamond isometric.

Pedestrians are horizontal textured planes rotated around Z, as shown in `src/OpenGta2.Client/Components/PedManagerComponent.cs`. They are not upright 3D billboards.

## Why NOCK0 Looks Flat

The current `src/OpenGta2.WebExporter/WebAssetExporter.cs` only exports block lid textures. It discards:

- Wall faces.
- Mesh vertices and indices.
- Slopes and partial geometry.
- Depth-buffer relationships.
- Per-face shading.
- Real elevation.

It then generates an orthogonal Tiled map, one large ground preview, and one elevated overlay. Phaser renders those as flat images in `/Users/jimmyjiggler/Documents/2026/opengta/nock0-action/src/game/district-scene.ts`.

The server collision in `/Users/jimmyjiggler/Documents/2026/opengta/nock0-action/server/world-map.ts` is also one binary value per XY tile. It cannot represent a bridge and roadway occupying the same XY position at different heights.

## Recommended Architecture

Do not port the MonoGame client or run OpenGTA2 in the browser. Use OpenGTA2 as an **offline converter** and Three.js as the browser renderer.

Add a renderer-neutral geometry library to OpenGTA2:

```text
OpenGta2.GameData -> OpenGta2.Geometry -> OpenGta2.WebExporter
                                      -> OpenGta2.Client adapter
```

Move or port `SlopeGenerator` into `OpenGta2.Geometry`. It must output plain CPU data without MonoGame `GraphicsDevice`, `VertexBuffer`, or `Matrix` dependencies.

Export:

```text
public/assets/maps/3d/world.json
public/assets/maps/3d/tiles.png
public/assets/maps/3d/chunks/12-12.bin
public/assets/maps/3d/chunks/12-13.bin
public/assets/maps/3d/surfaces.json
```

Each chunk should contain separate opaque and alpha-tested meshes:

```text
position: float32 x, y, z
uv: float32 u, v
shade: normalized uint8
indices: uint16
```

Use a `2048 x 2048` atlas: 32 columns of 64-pixel tiles support all 1,024 possible GTA2 tile IDs. Convert tile-local UVs into atlas UVs during export.

## Browser Renderer

Add Three.js and build a `ThreeDistrictRenderer`. All map geometry, players, NPCs, cars, weapons, and projectiles must eventually use the same Three scene so the depth buffer handles bridges and rooftops correctly. Do not permanently overlay Phaser actors over a separate Three map canvas.

Keep server coordinates in pixels:

```text
one GTA block = 64 server/world pixels
renderPosition = (serverX, -serverY, blockZ * 64)
```

Use a vertical `PerspectiveCamera` with `45-degree` FOV. Set world Y to negative server Y so screen-up remains north. Derive camera height from the desired visible world span instead of hard-coding it.

Render existing character and vehicle sheets on horizontal planes:

- Player plane: `72 x 72`.
- Vehicle plane: `96 x 96`.
- Position Z: sampled ground height plus a small offset.
- Rotation: convert the server's Y-down angle into Three's Y-up coordinate system.
- Texture filtering: nearest-neighbor.
- Material: alpha test with depth writing enabled.

## Implementation Order

1. Add geometry extraction and export one `8 x 8` chunk.
2. Build a standalone Three.js map viewer behind `?renderer=three`.
3. Verify cubes, slopes, partial blocks, UV rotation, flipping, transparency, and shading.
4. Export the current `64 x 64` district as chunked geometry.
5. Render current network players, NPCs, vehicles, weapons, and bullets in Three.
6. Adapt input aiming through camera raycasting onto the active ground plane.
7. Match current HUD, minimap, labels, interpolation, and camera following.
8. Make Three the default renderer and remove the Phaser map/overlay renderer.
9. Only afterward add authoritative Z and multi-level server collision.

For the first playable milestone, keep current 2D server collision and use the exporter's selected pedestrian surface to place actors vertically. This preserves gameplay while proving the 3D rendering. It will not yet allow separate simultaneous traffic above and below the same XY cell.

## Later Collision Upgrade

Export navigation surfaces and wall segments by height. Then add `z` or `surfaceId` to replicated players, NPCs, vehicles, and bullets. Update APIs to accept elevation:

```ts
canOccupy(x, y, z, radius)
groundHeightAt(x, y, preferredZ)
hasLineOfSight(fromX, fromY, fromZ, toX, toY, toZ)
```

Do not directly port OpenGTA2's collision implementation: it currently operates at a fixed Z and contains unfinished movement-sliding logic.

## Known Deferred Features

- Map objects from `MOBJ`.
- Animated map tiles.
- Timed map lights.
- Emergency and traffic route data.
- Full slope-aware vehicle physics.
- Multi-level authoritative navigation.
- Interior combat, NPC schedules, services, garage vehicle transfer, and multiple floors.

## Acceptance Criteria

- The Three viewer matches OpenGTA2's geometry for representative normal, diagonal, partial, and sloped blocks.
- Bridges and roofs occlude actors through the depth buffer.
- No hand-maintained overlay image is required.
- Existing multiplayer and gameplay state remain server-authoritative.
- Current original player, civilian, police, and vehicle assets remain active.
- Desktop and mobile maintain stable frame pacing.
- The old Phaser renderer remains available behind a temporary fallback flag until parity.

## Licensing Constraint

OpenGTA2 code is MIT licensed. GTA2 maps, textures, sprites, and layout remain Rockstar copyrighted even though GTA2 was previously distributed free of charge. Treat exported GTA2 content as a private compatibility fixture. A public release will need original textures, geometry/layout, sprites, vehicles, and branding.

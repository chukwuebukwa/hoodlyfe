# Seamless Building System Specification

Status: Draft
Target: Nock0 freeroam district
Prototype: Quick Stop Market

## 1. Summary

The seamless building system turns selected GTA2 map buildings into playable interiors without
teleporting players into another room. The original exterior shell remains part of the streamed
map. When the local player enters an authored enclosure, the client removes that building's
exported cutaway geometry and reveals a server-authoritative floor plan, fixtures, interactions,
and occupants beneath it.

Quick Stop Market proves the rendering and collision approach. This specification replaces its
building-specific TypeScript and C# configuration with one versioned, data-driven pipeline that
can support storefronts, apartments, warehouses, garages, offices, safehouses, and civic
buildings throughout the district.

The system must remain selective. Buildings without an authored manifest remain unchanged and
inaccessible.

## 2. Goals

- Reuse existing GTA2 building shells instead of constructing duplicate exterior buildings.
- Keep players in the street world, with no loading screen or space teleport.
- Support rectangular and irregular layouts made from connected axis-aligned footprints.
- Make roof and shell removal local to each viewing client.
- Keep movement, collision, combat, services, and interactions server authoritative.
- Use one manifest as the source of truth for the exporter, server, browser, tests, and editor.
- Stream presentation content by proximity instead of instantiating every interior at startup.
- Preserve deterministic simulation and browser/server collision parity.
- Provide an authoring workflow that does not require hand-editing generated triangle indices.

## 3. Non-Goals

- Making every decorative building enterable.
- Supporting arbitrary multi-floor buildings in the first release.
- Replacing existing isolated interiors immediately.
- Implementing robberies, ownership, housing persistence, or business economies in the building
  foundation.
- Letting clients authorize purchases, entry, loot, damage, or service use.
- Runtime detection of roofs through height heuristics or destructive mesh editing.

## 4. Building Modes

The world supports two explicit interior modes.

### 4.1 Seamless Cutaway

- The actor remains in `spaceId: "street"`.
- The server assigns an optional `enclosureId` from the building catalog.
- The local client hides the matching exported cutaway group.
- Static walls, fixtures, and doors replace the original solid map collision inside authored
  footprints.
- This mode is intended for single-floor buildings whose shell can be removed coherently.

### 4.2 Isolated Interior

- The actor transitions to a dedicated `spaceId`.
- Existing interior replication and doorway behavior remain authoritative.
- This mode remains appropriate for multi-floor, underground, instanced, private, or otherwise
  spatially incompatible interiors.

The two modes share stable IDs and authoring concepts but do not share movement semantics.

## 5. Source Of Truth

Add a versioned manifest at:

```text
shared/content/buildings/buildings.json
```

All authored coordinates use GTA source-map block units. One block equals 64 runtime pixels.
Fractional block coordinates are allowed. The building compiler converts them into runtime pixel
coordinates and rejects non-finite or out-of-world values.

Generated map geometry remains under:

```text
public/assets/maps/geometry/world.json
public/assets/maps/geometry/chunks/*.json
```

The compiler additionally writes a runtime building package:

```text
public/assets/maps/buildings.json
```

Generated files must never become an independently edited source of truth.

## 6. Manifest Contract

The initial schema is intentionally constrained to unions of rectangles. This matches the GTA
block map, keeps collision deterministic, and avoids introducing a polygon engine before it is
needed.

```ts
interface BuildingManifest {
  version: 1;
  sourceLevel: string;
  blockSize: 64;
  fixturePrefabs: FixturePrefabDefinition[];
  buildings: BuildingDefinition[];
}

interface BuildingDefinition {
  id: string;
  label: string;
  districtId: string;
  mode: "seamless-cutaway" | "isolated";
  kind:
    | "store"
    | "apartment"
    | "warehouse"
    | "garage"
    | "office"
    | "civic"
    | "safehouse";
  shell: BuildingShellDefinition;
  floorZ: number;
  footprints: SourceRect[];
  connectors: SourceRect[];
  revealAreas: SourceRect[];
  entrances: BuildingEntranceDefinition[];
  fixtures: BuildingFixtureInstance[];
  serviceBindings: BuildingServiceBinding[];
  signage?: BuildingSignageDefinition;
  tags: string[];
}

interface BuildingSignageDefinition {
  exterior: string;
  service?: string;
}

interface BuildingShellDefinition {
  cutawayMode: "lid-only" | "complete-above-floor";
  bounds: SourceBounds3D;
  expectedTriangleCount: number;
}

interface SourceRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SourceBounds3D extends SourceRect {
  minZ: number;
  maxZ: number;
}

interface BuildingEntranceDefinition {
  id: string;
  side: "north" | "east" | "south" | "west";
  x: number;
  y: number;
  width: number;
  actorKinds: Array<"player" | "pedestrian" | "vehicle">;
}

interface FixturePrefabDefinition {
  id: string;
  visualKey: string;
  collision: "none" | "bounds";
  defaultHeight: number;
  tags: string[];
}

interface BuildingFixtureInstance {
  id: string;
  prefabId: string;
  bounds: SourceRect;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
  variant?: string;
}

interface BuildingServiceBinding {
  id: string;
  type: "ammunition" | "clothing" | "medical" | "repair" | "job" | "shop";
  fixtureId?: string;
  x: number;
  y: number;
}
```

### 6.1 Identity Rules

- Building IDs are permanent kebab-case identifiers and are never reused.
- Entrance, fixture, and service IDs are unique within one building.
- Gameplay persistence stores building IDs, never array indices or generated triangle ordinals.
- Renaming a display label does not change identity.

### 6.2 Geometry Rules

- Footprints may touch or overlap but must compile into one connected enclosure.
- Connectors explicitly bridge visual floor insets and shared-wall openings.
- Reveal areas must be contained by the union of footprints and connectors.
- Entrances must intersect the perimeter and leave a collision-safe passage.
- Fixtures with bounds collision must be contained inside the playable enclosure.
- `complete-above-floor` may remove vertical shell faces only inside its tight 3D bounds.
- Two buildings may not claim the same source triangle.

## 7. Build Pipeline

### 7.1 Manifest Validation

Add `shared/content/building-manifest.ts` with a strict parser and immutable runtime types. The
parser validates schema version, IDs, finite coordinates, positive dimensions, containment,
connectivity, fixture references, service references, and supported modes.

The same JSON file is read by OpenGTA2. The exporter must reject unknown fields only when they
affect geometry ownership; non-geometry gameplay fields remain available to the TypeScript
compiler.

### 7.2 OpenGTA2 Export

Replace the hardcoded `ThreeOccluders` array in `WebAssetExporter` with definitions loaded from
the manifest.

For each building:

1. Rebase source bounds against the active crop.
2. Select triangles using `lid-only` or `complete-above-floor` semantics.
3. Fail when no triangles are selected.
4. Fail when selected triangles overlap another building group.
5. Fail when the count differs from `expectedTriangleCount`.
6. Remove selected triangles from permanent chunk indices.
7. Emit the selected triangles under the stable building ID in every affected chunk.
8. Emit the total and source bounds in `geometry/world.json`.

`scripts/export-gta2-assets.sh` passes the manifest path explicitly to the exporter. A fresh asset
export from a local GTA2 installation must reproduce committed geometry byte-for-byte.

### 7.3 Runtime Building Compilation

Add `scripts/compile-buildings.ts`. It converts source blocks to runtime pixels and emits:

- normalized footprint, connector, reveal, entrance, fixture, and service coordinates;
- precomputed enclosure bounds;
- chunk ownership;
- collision exclusions and merged static rectangles;
- stable content and source-map revision hashes;
- expected cutaway metadata.

`npm run assets:export` runs the GTA exporter, building compiler, and district validator in that
order.

## 8. Server Architecture

Add a `BuildingRegistry` under `server/game/buildings/`. It owns immutable compiled definitions
and spatial indexes. `DistrictRoom` may construct the registry and route messages but must not
contain building-specific policy.

### 8.1 Enclosure Membership

The server derives `player.enclosureId` after authoritative movement resolves.

- Membership is based on reveal areas with bounded exit hysteresis.
- `spaceId` remains `street` for seamless buildings.
- Death, respawn, teleport, vehicle entry, and disconnect clear or recompute membership.
- A player cannot claim enclosure membership through a client message.

The same membership concept may be added to pedestrians and vehicles when a building permits
those actor kinds.

### 8.2 Collision

Replace linear scans through all seamless rectangles with a compiled spatial index.

- Base map collision is excluded only within authored footprints.
- Authored perimeter walls and fixtures restore the intended collision.
- Connector passages must remain open.
- Browser prediction and server authority consume the same compiled collision package.
- Rapier receives deterministic, sorted, merged static rectangles.
- Static rectangle creation must not occur during ordinary simulation ticks.

The index is keyed by map cell or geometry chunk. Point and circle queries inspect only local
candidates, not every building or fixture in the district.

### 8.3 Interactions And Services

Service controllers consume compiled service bindings through domain-specific ports. The server
validates:

- actor identity and life state;
- matching enclosure or entrance context;
- distance and line of sight;
- funds, cooldowns, inventory, and service-specific policy.

The client only presents prompts and sends intent. Robbery and ownership systems may consume the
same bindings later but are not part of the foundation.

### 8.4 AI And Combat

- Pedestrian navigation treats entrances and connector passages as graph portals.
- Static fixtures participate in pathfinding and line-of-sight checks.
- Projectiles and melee use existing physical surfaces and authored collision.
- Police and witnesses may perceive actors through entrances but not through opaque walls.
- Building membership does not independently suppress wanted state or damage.

## 9. Client Architecture

Add a `BuildingPresentationRegistry` under `src/game/presentation/buildings/`.

### 9.1 Cutaway Visibility

- Only the local player's enclosure controls roof visibility.
- Outside viewers retain the roof even if another player is inside.
- Entering hides every streamed cutaway group with the matching building ID.
- Exiting restores every group after the configured hysteresis margin.
- Streaming a chunk while already inside immediately applies the hidden state.
- Unloading and reloading a chunk must not lose cutaway ownership.

### 9.2 Presentation Streaming

Static interior presentation is loaded by building chunk proximity.

- Metadata remains resident because it is small.
- Floor, wall, sign, and fixture meshes are created only within the presentation preload ring.
- Static fixtures sharing a material should use merged geometry or instancing.
- Buildings outside the retention ring release geometry, materials, and generated textures.
- Dynamic actors remain owned by normal network AOI and are never duplicated by presentation.

### 9.3 Enclosure-Aware Presentation

When the local player is outside a building:

- the roof remains visible;
- remote interior nameplates and context prompts are suppressed through the roof;
- interior-only effects and service markers are hidden.

When the local player is inside:

- actors in the same enclosure render normally;
- exterior actors remain visible where map geometry permits;
- context prompts anchor to their authored fixture or service location.

### 9.4 Audio

Voice and world audio retain street-space routing but apply enclosure occlusion:

- same enclosure: normal proximity attenuation;
- one actor inside and one outside: reduced gain and low-pass filtering;
- different enclosures: inaudible unless a later communication system overrides it.

The server supplies enclosure identity; the client applies presentation-level filtering.

## 10. Authoring Workflow

Add a Buildings mode to the existing district editor.

The author must be able to:

1. Select an existing source-map building.
2. Draw one or more footprint rectangles.
3. Draw connectors between attached wings.
4. Place and size entrances.
5. Define the 3D cutaway bounds and cutaway mode.
6. Preview selected source triangles before export.
7. Place fixture prefabs and service anchors.
8. Toggle exterior, cutaway, collision, and navigation previews.
9. validate and save the source manifest.

The editor must show triangle count, overlapping ownership, disconnected footprints, blocked
entrances, fixture collisions, and out-of-bounds content before save. It must never write raw
triangle indices.

## 11. Prefab Strategy

The first fixture library should cover reusable structural and gameplay needs:

- wall and doorway segments;
- checkout and service counters;
- short and tall shelves;
- coolers and refrigerators;
- desks and office partitions;
- beds, sofas, tables, and wardrobes;
- warehouse racks and crates;
- garage lifts, tool cabinets, and bollards;
- stairs or elevators as non-functional reserved fixtures for future floors.

Fixture prefabs define visuals and default collision. Building manifests own placement and
gameplay binding. A visual prefab must not contain authoritative prices, rewards, inventory, or
mission rules.

## 12. Performance Requirements

The initial production target is up to 200 authored buildings and 2,000 static fixtures in one
district package.

- No per-frame or per-tick scan over every building.
- Enclosure lookup is spatially indexed and bounded by nearby candidates.
- Stable movement inside a building performs zero allocation-heavy catalog reconstruction.
- Static collision is compiled once and sorted deterministically.
- Distant building presentations contribute zero draw calls.
- Nearby static fixtures use no more than one draw call per material group where practical.
- Entering or exiting one building must not rebuild another building's geometry or physics.
- Physics p95 and memory acceptance thresholds remain those of the persistent physics rollout.

## 13. Multiplayer Requirements

Test at least two clients in all enclosure scenarios:

- both outside;
- one inside and one outside;
- both inside the same building;
- each inside a different building;
- one crossing an entrance while the other observes;
- reconnect and respawn while inside;
- vehicle passenger state at a vehicle-enabled entrance.

Roof visibility is intentionally client-local. Collision, damage, service use, actor state, and
enclosure membership remain server authoritative. A client may never hide a roof to bypass
collision, line of sight, or interaction range.

## 14. Validation And Tests

### 14.1 Static Validation

- Manifest schema and identity uniqueness.
- Source bounds within the active map.
- Connected footprint graph.
- Entrance and reveal-area containment.
- Fixture and service reference integrity.
- No cutaway triangle ownership overlap.
- Exact expected triangle count per building.
- Generated chunk total equals world-manifest total.
- Browser and server collision packages hash identically.

### 14.2 Unit And Integration Tests

- Membership entry and exit hysteresis.
- Base-collision replacement and authored-wall restoration.
- Open entrance and connector corridors.
- Deterministic static collider compilation.
- Chunk-indexed lookup boundaries.
- Cutaway state before and after chunk streaming.
- Service authorization inside and outside the enclosure.
- Projectile, melee, AI path, and line-of-sight behavior.
- Two-client local roof visibility and nameplate suppression.
- Clean leave, reconnect, death, and respawn transitions.

### 14.3 Browser QA

For every pilot building, verify desktop and mobile views:

- the exterior shell is unchanged while outside;
- only the selected building disappears on entry;
- floors and fixtures are visible with no floating roof remnants;
- attached wings have continuous floors and open connectors;
- neighboring roofs, vegetation, roads, and railway geometry remain intact;
- collision matches visible walls and fixtures;
- leaving restores the complete shell;
- reload while inside converges to the correct visibility state;
- no blank chunks, stale props, new console errors, or layout overflow.

## 15. Migration Plan

### Phase 0: Preserve The Prototype

- Keep Quick Stop functional while introducing the manifest parser.
- Encode its two footprints, connector, entrance, fixtures, and 86-triangle complete cutaway in
  the source manifest.
- Prove generated geometry and runtime behavior remain unchanged.

### Phase 1: Generic Runtime

- Add the compiler, building registry, spatial index, and streamed presentation registry.
- Remove Quick Stop-specific catalog and exporter configuration.
- Retain existing isolated interiors without modification.

### Phase 2: Pilot Content

Author three additional buildings:

- a second small storefront to prove repeatability;
- an irregular warehouse to stress connected footprints;
- a garage with a vehicle-width entrance to establish vehicle policy.

### Phase 3: Editor Workflow

- Add building footprint, shell, entrance, fixture, and preview tools.
- Require editor validation for all subsequent buildings.

### Phase 4: District Expansion

- Select high-value buildings near jobs, services, and player routes.
- Expand in bounded content batches with browser and multiplayer QA.
- Target 10-20% enterable buildings, not universal access.

### Phase 5: Gameplay Adoption

- Move shops, treatment, clothing, repair, job contacts, and safehouses onto building bindings.
- Add robbery, ownership, and persistent housing only as separate domain features.

## 16. Acceptance Criteria

The foundation is complete when:

- Quick Stop is fully defined by the shared manifest with no building-specific exporter entry.
- A clean GTA2 asset export reproduces every cutaway group and exact triangle count.
- At least three additional pilot buildings use the same pipeline.
- Irregular connected footprints and vehicle-width entrances are proven.
- Browser and server collision remain identical.
- Building lookup and presentation are spatially streamed.
- Two-client enclosure behavior passes all required scenarios.
- Existing collision, traffic, combat, physics, netcode, and isolated-interior tests remain green.
- A ten-minute multiplayer traversal test reports no stale roofs, stale props, blocked entrances,
  duplicate actors, disconnects, or simulation stalls.
- Production build, map validation, deterministic replay, and full browser QA pass.

## 17. Rollback

Each building definition has an `enabled` rollout flag in compiled deployment configuration, not
in persistent identity. Disabling a building restores permanent shell geometry, base map
collision, and exterior-only behavior on the next deployment.

Roll back an individual building when it produces missing geometry, collision escape, stale roof
state, actor visibility leakage, or deterministic simulation differences. Roll back the system
when spatial indexing or compiled collision regresses district-wide performance or stability.

## 18. Decisions

- Seamless buildings remain in street space and receive a separate enclosure identity.
- The authoring primitive is a union of axis-aligned rectangles.
- Roof ownership is exporter-authored and never inferred at runtime.
- Complete cutaway is opt-in per building; lid-only remains the safe default.
- Static props are streamed client-side and compiled into authoritative collision server-side.
- Gameplay rules bind to service anchors but remain owned by their domain controllers.
- Existing isolated interiors coexist with this system.
- Enterable buildings are curated for gameplay value rather than enabled universally.

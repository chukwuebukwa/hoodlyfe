# World Authoring, Playtest, And Interior Plan

## Objective

The level editor must become the single authoring surface for district geometry contracts,
collision, roads, lanes, spawns, buildings, seamless interiors, portals, services, and later
population and mission anchors. An editor change is useful only when the exact saved revision
can be played and promoted without hand-copying data into runtime catalogs.

The editor does not run a second implementation of game simulation. It authors source data,
compiles immutable runtime packs, and asks the normal game server and renderer to consume those
packs.

## Identity Contract

Identity is intentionally split instead of overloading one string:

| Field | Example | Purpose |
| --- | --- | --- |
| Asset source ID | `bil` | Selects converted map and Three.js assets. Stable only within the asset pipeline. |
| World ID | `industrial-district` | Canonical authored district identity used by editor documents and runtime manifests. |
| Entity ID | UUIDv7 | Permanent identity for a building, interior, portal, service, spawn, or authored object. Never derived from a name. |
| Slug | `mercy-hospital` | Human-readable lookup and URL label. Unique within its entity kind and editable through an explicit rename. |
| Display name | `Mercy Hospital` | User-facing copy; freely editable. |
| Revision ID | first 24 hex characters of a SHA-256 content hash | Immutable identity for a complete source snapshot or compiled pack. |

An interior therefore uses a record shaped like:

```ts
interface InteriorSource {
  id: string;          // UUIDv7, for example 019f8...; permanent references use this.
  slug: string;        // mercy-hospital
  displayName: string; // Mercy Hospital
  buildingId: string;  // UUIDv7 of the selected exterior building.
  spaceId: string;     // UUIDv7 replication-space identity.
}
```

`district=bil` in a browser route selects assets. A playtest revision internally retains
`industrial-district`. The two IDs must never be compared as if they were interchangeable.

## Source And Runtime Boundaries

### Mutable source document

The editor owns one versioned source document. The existing v1 layers remain valid:

- collision and road grids;
- lane corridors, junctions, and roadblocks;
- spawn anchors.

The next schema version adds these normalized layers:

- `buildings`: footprints, facade edges, roof groups, floor elevation, and source references;
- `interiors`: room polygons, walls, fixtures, service anchors, and presentation style;
- `portals`: paired exterior/interior thresholds, facing, width, access policy, and transition
  rules;
- `spaces`: replication and visibility ownership;
- `services`: typed anchors that reference a space and owning interior;
- `worldObjects`: lights, signals, pickups, parking, mission anchors, and property entrances.

References use UUIDs. Slugs are indexed metadata, never foreign keys. Domain modules own their
types, validators, and compiler adapters; `LevelEditorApp` only coordinates commands and panels.

### Immutable runtime pack

A deterministic compiler consumes one source revision and emits a manifest plus domain packs:

```text
runtime-pack/<revision-id>/
  manifest.json
  map/collision.bin
  map/roads.bin
  navigation/lanes.json
  population/spawns.json
  buildings/index.json
  interiors/interiors.json
  interiors/portals.json
  presentation/occluders.json
  presentation/fixtures.json
  replication/spaces.json
  services/anchors.json
```

`manifest.json` records schema versions, source and pack hashes, asset source ID, world ID,
compiler version, dimensions, origin, and every file hash. Compilation must be deterministic:
the same normalized source produces byte-identical output independent of object insertion order.

Runtime code imports pack contracts from `shared/`; it never imports React/editor modules. The
server remains authoritative for movement, portals, collision, services, and replication-space
membership. Clients use the same pack for prediction and presentation but cannot choose a space
transition or bypass collision.

## Play Draft Workflow

### Milestone 1: local immutable walk preview

Implemented on `codex/world-authoring-playtests`:

1. Validate the current in-memory document.
2. Canonicalize and hash it.
3. Save an immutable revision to IndexedDB.
4. Open `/explore?district=bil&revision=<hash>`.
5. Load the exact revision in a fresh tab.
6. Use its collision grid and enabled player spawn while continuing to stream the current
   converted Three.js presentation chunks.

This proves that unsaved edits can be snapshotted and walked without applying files to the
repository. The status bar retains a link to the last revision so popup blocking cannot lose it.
Local revisions are capped per district and are explicitly labeled `PLAY DRAFT`.

### Milestone 2: compiled local preview

Move collision/spawn adaptation out of the explorer and run the deterministic compiler in a Web
Worker. Cache the resulting pack by revision ID. The explorer consumes only pack contracts. Add a
pack-inspection panel that reports source hash, compiler version, validation state, and loaded
domain counts.

### Milestone 3: authoritative playtest room

Add a server-side playtest registry and a dedicated room type:

1. Upload or POST a validated source revision to a development-only endpoint.
2. Compile and cache the runtime pack server-side.
3. Create a room pinned to `{worldId, revisionId}`.
4. Construct collision, lanes, interiors, services, population, and replication from that pack.
5. Join through the normal Three.js game client with a visible playtest banner.

Every participant in a room uses the same revision. A room never hot-swaps packs. Creating a new
revision creates a new room, while existing rooms drain normally.

## Building And Interior Authoring

### Building index

The converter/compiler produces candidate building records from map geometry. Each record owns:

- a stable UUID after first adoption;
- source geometry references and world-space footprint;
- facade edges and street-facing normals;
- roof triangle groups and elevations;
- default exterior collision;
- diagnostics for overlap, inaccessible frontage, and unsupported geometry.

Generated candidates are suggestions until adopted into source data. Once adopted, their UUID is
preserved even if the slug, display name, or geometry changes.

### Interior creation wizard

The editor workflow is:

1. Select an adopted building in the map or object tree.
2. Choose **Create interior**.
3. Generate a UUIDv7 interior ID and space ID; require a unique slug such as
   `mercy-hospital` and a display name.
4. Seed a single-floor room polygon inside the building footprint with configurable wall inset.
5. Select a valid facade edge and place a doorway constrained to that edge.
6. Generate paired portal thresholds, collision openings, safe entry/exit anchors, and a named
   roof-occluder reference.
7. Enter interior edit mode to place walls, fixtures, services, and spawn/recovery anchors.
8. Validate, compile, and Play Draft the result.

“Hollowing out” a building does not destructively edit converted art. The compiler emits an
interior floor/shell, a collision override for the doorway and room, and an exact named roof group
that the renderer hides only for players inside that space. Exterior walls and neighboring roofs
remain source-owned.

### Interior validation

Compilation blocks on:

- duplicate UUIDs or slugs;
- interior polygons outside their building footprint;
- doorway thresholds not lying on the selected facade;
- entry/exit anchors outside their expected spaces or inside obstacles;
- disconnected walkable interior regions;
- missing roof groups or roof groups that include neighboring geometry;
- fixture presentation without matching authoritative collision;
- service anchors without a matching space/interior owner;
- portal pairs that do not agree on width, facing, or linked spaces.

## Draft, Publish, And Activation

Local autosave is recovery state, not a deployment mechanism.

1. **Draft:** mutable browser source document.
2. **Revision:** immutable, content-addressed snapshot.
3. **Playtest:** local pack or authoritative room pinned to one revision.
4. **Publish:** upload source and compiled pack to object storage under the revision ID.
5. **Activate:** atomically update a small environment manifest from the previous revision to the
   approved one.
6. **Rollback:** point the manifest back to an earlier immutable pack.

Railway object storage can hold revision artifacts, but a database row or signed manifest must own
revision metadata, status, creator, timestamps, validation report, and active-environment pointer.
Never overwrite an active pack in place.

## Implementation Order

1. Lock identity, source schema ownership, compiler contract, and ADRs.
2. Finish local immutable Play Draft and browser QA.
3. Add deterministic compiler, manifest, and domain pack contract tests.
4. Make explorer and `DistrictRoom` construct map/collision/lanes/spawns from a supplied pack.
5. Add server-backed playtest revisions and revision-pinned rooms.
6. Generate and adopt a building index.
7. Add building selection, interior wizard, and focused interior edit mode.
8. Compile portals, collision openings, roof groups, fixtures, services, and spaces.
9. Replace hardcoded interior catalog reads with compiled pack adapters.
10. Add cloud draft history, review diff, publish, atomic activation, rollback, permissions, and
    retention.

Each milestone must keep `main` playable. Temporary adapters may translate current hardcoded
catalog data into a pack, but new gameplay code must depend on pack contracts rather than adding
more building-specific branches.

## Acceptance Matrix

- A dirty editor document can launch an immutable revision without downloading or applying files.
- Reloading the revision in a fresh tab produces the same spawn and collision behavior.
- Changing one source field changes the revision ID; reordering object keys does not.
- Two clients in an authoritative preview join the same pinned revision.
- An interior can be created from a building without manually editing TypeScript catalogs.
- Walking through its door is server-authoritative, seamless, and changes replication space.
- Only the selected roof group hides; neighboring geometry remains stable.
- Export, local preview, authoritative preview, publish, rollback, and production activation all
  use the same compiler and runtime pack contracts.
- Full tests, production build, browser console checks, and desktop/mobile nonblank canvas checks
  pass before a revision is eligible for activation.

# World Content Revisions

The game process is the engine. A world-content revision is the data that both the
authoritative room and browser must use for one world instance.

## Runtime contract

`WorldContentRepository.resolveCurrent("bil")` resolves the mutable pointer once and
returns an immutable `WorldContentSnapshot`. `DistrictRoom` keeps that snapshot for its
entire lifetime. It never polls the bucket and never performs storage reads during a
simulation tick.

The snapshot owns:

- the collision map and surface manifest used to create a fresh `CollisionMap` per room;
- the lane document used to create that room's `LaneGraph`;
- the compiled seamless-building catalog used by collision, garage doors, services, and QA;
- the exact revision-scoped asset root sent to the browser.

The browser reads the replicated `contentRevision`, `contentAssetRoot`, and
`contentBuildingsPath` fields before starting `DistrictClient`. Geometry, textures,
metadata, minimap images, and buildings then come from the same revision. Character,
audio, weapon, and other media continue to come from the deployed `/assets` tree.

## Bucket layout

```text
worlds/bil/current.json
worlds/bil/revisions/<revision>/manifest.json
worlds/bil/revisions/<revision>/content/buildings.json
worlds/bil/revisions/<revision>/maps/district-map.json
worlds/bil/revisions/<revision>/maps/district-map.metadata.json
worlds/bil/revisions/<revision>/maps/surface-manifest.json
worlds/bil/revisions/<revision>/maps/district-lanes.json
worlds/bil/revisions/<revision>/maps/geometry/world.json
worlds/bil/revisions/<revision>/maps/geometry/chunks/*.json
worlds/bil/revisions/<revision>/maps/geometry/tiles.png
```

Revision objects are immutable. The publisher uploads all assets, writes the revision
manifest last, and advances `current.json` only after the package is complete. Existing
rooms therefore remain on their old revision while newly created rooms receive the new
one. The game server caches the current pointer for at most 15 seconds.

## Publishing

Validate and inspect without writing:

```bash
npm run world:publish -- bil --dry-run
```

With Railway bucket credentials in the environment, publish and advance the pointer:

```bash
npm run world:publish -- bil
```

Production uses bundled content unless explicitly enabled:

```text
WORLD_CONTENT_SOURCE=bucket
AWS_ENDPOINT_URL=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET_NAME=...
AWS_DEFAULT_REGION=auto
AWS_S3_URL_STYLE=virtual
```

Startup resolves and validates BIL before the HTTP server listens. An incomplete or
invalid current revision makes the deployment fail rather than running a mixed world.

## Authoring pipeline

The current Builder Gun flow remains reviewable:

1. Create one or more local drafts.
2. Import or export them with `npm run buildings:import` / `npm run buildings:publish`.
3. Run map and content tests.
4. Publish the resulting world package with `npm run world:publish -- bil`.

A future worker can execute steps 2-4 from a queued editor job. It must retain the same
immutable package and pointer-last protocol. The worker should use MySQL for publication
locking and audit history because Railway Buckets do not provide object locks or native
object versioning.

## Current limitations

- The first publisher uploads a complete revision. Chunk-delta/base-revision reuse is a
  later optimization.
- Only the active BIL world is bucket-selectable. Arena and secondary district rooms keep
  their bundled content paths.
- Publishing is a trusted CLI operation. The production editor still needs authentication
  before it can enqueue or approve world publishes.
- Player accounts, inventory, money, live entities, server algorithms, and secrets do not
  belong in world content.

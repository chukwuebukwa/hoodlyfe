# Authoritative Surface Adaptation Contract

Date: 2026-07-19

Status: Stages 0–2 complete; Stages 3–4 in progress

## Objective

Represent stacked roads, bridges, ramps, roofs, and interior floors without replacing
the deterministic Rapier2D simulation. XY never selects elevation. Authority selects a
stable surface ID; shared map data derives height and collision.

## Domain terms

- `spaceId` is a replication and visibility realm such as `street` or an interior.
- `surfaceId` is one non-overlapping physical sheet inside a space, such as
  `street-ground`, `north-bridge`, or `north-bridge-ramp-west`.
- Surface height is derived from `surfaceId` and XY. It is not independently authored
  by gameplay controllers or guessed by the renderer.
- A transition is an authored seam connecting two surfaces. Ramps, stairs, doors, and
  permitted drop-offs are transitions.

`layerId` is a temporary netcode alias for the physical surface. Once every physical
entity carries `surfaceId`, `layerId` is deleted rather than maintained as a second
classification.

## Invariants

- The server owns every surface transition.
- Server and client load the same manifest collision revision.
- Players, pedestrians, vehicles, projectiles, props, spawns, and navigation records
  identify their surface explicitly.
- Entities on different surfaces do not collide, even when their XY coordinates overlap.
- Combat, perception, spatial queries, and effects are same-surface by default.
  Cross-surface behavior requires an authored rule.
- Rendering uses `heightAt(surfaceId, x, y)`. The topmost surface at XY is never an
  actor-placement rule.
- Clients render the replicated authoritative surface transition; they never infer one
  from XY.

## Asset ownership

OpenGTA2 remains the offline converter. It exports a compact, versioned surface
manifest separately from render meshes. The manifest contains:

- stable surface IDs and their `spaceId`;
- walkable triangles in server pixel coordinates, including exact slope heights;
- allowed actor kinds;
- directed transition seams and their allowed actor kinds;
- a positive collision revision shared by server and client.

The manifest is renderer-neutral. Three.js consumes height; server navigation and
spawning consume topology; Rapier consumes per-surface static geometry. These are
projections of one artifact, not separately authored maps.

## Runtime ownership

- `SurfaceMap` validates the manifest and owns height, occupancy, adjacency, and
  transition queries.
- `PhysicsWorld` hides the Rapier worlds used by physical surfaces. Simulation callers
  submit located bodies and do not manage Rapier worlds directly.
- Gameplay controllers own desired motion and execute-once outcomes.
- Navigation modules route surface-aware locations through the same topology.
- Replication and interaction snapshots carry authoritative surface identity.
- Three presentation derives Z only through `SurfaceMap`.

## Fixed-step flow

1. Controllers compute desired XY motion for an entity's current surface.
2. `SurfaceMap` detects a swept authored transition, if any.
3. The physics module registers the entity in the selected surface world and steps
   Rapier once at 30 Hz.
4. Authority writes back XY and `surfaceId`; Z remains derived.
5. Contacts and gameplay queries consider only compatible surfaces.
6. Clients interpolate snapshots only within the replicated authoritative surface.

## Migration stages

### Stage 0 — contract and executable fixture

- Add the versioned manifest contract and shared `SurfaceMap`.
- Prove an underpass and bridge can share XY at different heights.
- Prove a ramp transition is explicit, deterministic, and actor-gated.
- Keep all production entities on `street-ground`.

### Stage 1 — exporter and asset revision

- Export all traversable sheets rather than one selected pedestrian height per XY.
- Export stable transitions and validate missing, ambiguous, or discontinuous data.
- Load the same generated manifest on server and client.
- Reject mismatched collision revisions.

### Stage 2 — authoritative identity

- Add `surfaceId` to physical server schemas and client network types.
- Move `surfaceId` into common interaction state and bump affected protocols.
- Default existing street content to `street-ground`.
- Expose entity surface and derived height in F3 diagnostics.

### Stage 3 — topology consumers

- Route rendering, spawning, pedestrian navigation, traffic lanes, spatial queries,
  combat, perception, and effects through authoritative surface identity.
- Remove the global topmost `surfaceHeightAt(x, y)` actor-placement path.

### Stage 4 — layered physics

- Partition Rapier statics and bodies by surface behind `PhysicsWorld`.
- Transfer bodies only through authored transitions at fixed-step boundaries.
- Delete the temporary `layerId` alias and the flat collision-map path.

## 2026-07-19 implementation amendment

- Production actors now spawn with explicit surface identity instead of remaining on one
  placeholder sheet. Spawn selection enumerates `(XY, surfaceId)` candidates; existing
  actors never infer a new surface from XY.
- Server Rapier steps are partitioned by `surfaceId`, reusing one world sequentially.
  Flat collision statics apply only to the manifest's default sheet; elevated sheets use
  manifest occupancy, so walls below cannot block them.
- Dynamic rendering, traffic and pedestrian movement, lane and road navigation,
  interaction broad phase, explosions, fires, live projectiles, melee, and rewind
  hitboxes consume authoritative surface identity.
- The traffic-flow soak remains fully circulating with no prolonged-block regression.
  Its topology-aware throughput baseline is 2.5 junction traversals per vehicle (the
  deterministic production asset currently records 60 traversals for 23 vehicles).
- Clients render replicated surface transitions. Removal of the temporary `layerId`
  alias and the default sheet's flat collision path remain Stage 4
  work; elevated-route rollout must not be declared complete until those gates pass.

### Stage 5 — vertical content

- Enable one bridge and ramp route end to end.
- Verify players, NPCs, traffic, projectiles, and two clients above/below the same XY.
- Expand authored surfaces only after the fixture and soak gates remain green.

## Acceptance fixture

The permanent fixture contains a ground road, an overlapping bridge deck, and a ramp.
It must prove:

- ground and bridge return different heights at identical XY;
- actors on those surfaces never collide or target each other;
- ramp height is continuous and transitions only across its authored seams;
- invalid and mismatched manifests fail closed;
- replicated clients remain on the server-selected surface through a transition.

## Rejected shortcuts

- Clamping actor height hides the symptom but preserves ambiguous authority.
- Marking every elevated XY cell blocked destroys bridges and elevated roads.
- Reusing `spaceId` for elevation conflates physical sheets with privacy/replication.
- Rapier3D is deferred until gameplay requires falling, jumping, roll, or airborne rigid
  bodies. Sheet-based top-down traversal does not justify replacing Rapier2D.

## Rollback

Before Stage 4, disable elevated content and keep every entity on `street-ground`.
After flat collision deletion, rollback means deploying the last pre-cutover revision;
there is no permanent second collision implementation.

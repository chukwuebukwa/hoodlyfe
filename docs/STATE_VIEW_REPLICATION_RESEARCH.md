# Spatial State-View Replication

## Purpose

Authoritative simulation isolation is not sufficient for an online district. A client should not receive actors, traffic, combat transients, missions, or services from a spatial space it cannot observe. Sending everything and hiding it locally wastes bandwidth, exposes unrelated state, and makes future apartments, garages, businesses, and district transfers harder to secure.

## Pinned Framework Behavior

This implementation targets the installed `@colyseus/core 0.16.24` and `@colyseus/schema 3.0.76` sources.

- `Client.view` selects a `StateView` for full-state and patch encoding.
- A collection field must carry `view()` metadata before the serializer creates its encoder; a `StateView` alone does not activate filtering.
- `StateView.add()` recursively links the selected schema object through its map and root parents.
- `StateView.add()` does not force all fields while a change tree is still marked new; it assumes that cycle's filtered encode carries the complete object. A late observer can therefore receive the reference before unchanged newly added scalar fields.
- Map encoding calls its child filter for initial state, ordinary patches, and explicit view changes.
- `StateView.remove()` emits the client-specific delete operation without deleting the authoritative object.

The schema `DefinitionType` currently advertises a `view` option, but this installed `defineTypes()` implementation normalizes the type and does not apply that metadata. NOCK0 therefore calls the package's exported `view()` function explicitly after `defineTypes()`. Tests must exercise a real decoded client because `StateView.has()` cannot prove the encoder is filtering.

## Ownership

- `server/state.ts` declares which synchronized collections are eligible for view filtering.
- `DistrictReplicationController` owns client view membership and diffs desired schema references once per outgoing patch.
- Newly attached references remain in an `awaitingCompleteSnapshot` set until one post-encode `StateView.add()` queues their complete field set. Removal clears both membership sets, preventing a one-cycle visibility leak.
- `DistrictRoom` creates the controller, attaches/detaches each client's view, and invokes synchronization from `onBeforePatch()`.
- Gameplay domains continue mutating one authoritative district state. They do not know which clients observe an entity.
- Client renderers retain defensive space checks, but they are no longer the security or bandwidth boundary.

## Current Visibility Policy

Every client always receives players and services whose `spaceId` exactly matches its local player.

Street clients additionally receive:

- bullets, thrown projectiles, and explosions;
- weapon pickups and traffic signals;
- pedestrians and vehicles;
- active missions.

Interior clients receive none of those street collections. Global scalar district metadata remains replicated and negligible. Developer debug snapshots are a separate explicitly subscribed diagnostic channel and are not a production privacy surface.

## Street Area Of Interest

Street clients now receive NPCs and vehicles through the shared spatial index with an explicit hysteresis band: actors enter at 1,280 pixels and leave at 1,536 pixels. Patch work is bounded to 64 additions and 96 removals, ordered by distance and stable identity. The policy always retains:

- the local player and occupied vehicle;
- mission-owned actors/objectives relevant to the player;
- participant mission target vehicles.

Attackers, witnesses, police assignments, and distant crew markers still need explicit reduced representations rather than relying on ordinary actor membership.

Do not couple simulation activation to one client's view. `PopulationStreamingController` separately owns potential records, active ceilings, materialization hysteresis, dormant progress, and gameplay pins.

## QA Contract

- Unit tests verify street versus interior membership, dynamic additions, and reversible space transitions.
- A regression test advances the installed encoder through the first filtered cycle and verifies that the controller then queues a complete one-time snapshot.
- The real two-client integration test drives one client through the ordinary doorway. Its decoded state contracts to one player, zero NPCs, zero vehicles, zero missions, and one interior service; the street peer loses that player. Exit restores both views.
- Live Three QA verifies replicated shell counters change from `1/13/19` to `1/0/0`, Threads remains usable, missions disappear, the scene remains nonblank, and exit restores the street.
- Full regression and production build must pass after every schema-view change. A test that inspects only authoritative server state is not sufficient.

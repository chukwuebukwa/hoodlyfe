# Spatial State-View Replication

## Purpose

Authoritative simulation isolation is not sufficient for an online district. A client should not receive actors, traffic, combat transients, missions, or services from a spatial space it cannot observe. Sending everything and hiding it locally wastes bandwidth, exposes unrelated state, and makes future apartments, garages, businesses, and district transfers harder to secure.

## Pinned Framework Behavior

This implementation targets the installed `@colyseus/core 0.16.24` and `@colyseus/schema 3.0.76` sources.

- `Client.view` selects a `StateView` for full-state and patch encoding.
- A collection field must carry `view()` metadata before the serializer creates its encoder; a `StateView` alone does not activate filtering.
- `StateView.add()` recursively links the selected schema object through its map and root parents.
- Map encoding calls its child filter for initial state, ordinary patches, and explicit view changes.
- `StateView.remove()` emits the client-specific delete operation without deleting the authoritative object.

The schema `DefinitionType` currently advertises a `view` option, but this installed `defineTypes()` implementation normalizes the type and does not apply that metadata. NOCK0 therefore calls the package's exported `view()` function explicitly after `defineTypes()`. Tests must exercise a real decoded client because `StateView.has()` cannot prove the encoder is filtering.

## Ownership

- `server/state.ts` declares which synchronized collections are eligible for view filtering.
- `DistrictReplicationController` owns client view membership and diffs desired schema references once per outgoing patch.
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

## Scaling Limits

This is a coarse spatial partition, not full area-of-interest replication. A street client still receives the entire current district population. The next networking scale step should add stable spatial cells and hysteresis inside the street space, while always retaining:

- the local player and occupied vehicle;
- mission-owned actors/objectives relevant to the player;
- current attackers, witnesses, and police assignments for a bounded grace period;
- party/crew markers at a reduced update representation when distant;
- explicit add/remove budgets so crossing a cell boundary cannot create a patch spike.

Do not couple simulation activation to one client's view. Population level of detail and network observation are related policies with separate owners.

## QA Contract

- Unit tests verify street versus interior membership, dynamic additions, and reversible space transitions.
- The real two-client integration test drives one client through the ordinary doorway. Its decoded state contracts to one player, zero NPCs, zero vehicles, zero missions, and one interior service; the street peer loses that player. Exit restores both views.
- Live Three QA verifies replicated shell counters change from `1/13/19` to `1/0/0`, Threads remains usable, missions disappear, the scene remains nonblank, and exit restores the street.
- Full regression and production build must pass after every schema-view change. A test that inspects only authoritative server state is not sufficient.

# 0024 - Immutable World Revisions And Compiled Runtime Packs

## Status

Accepted

## Context

The editor can author collision, roads, lanes, roadblocks, and spawns, but the running game still
loads fixed repository files and hardcoded interior catalogs. Directly teaching each runtime
system to read mutable editor state would duplicate adapters, make multiplayer rooms disagree,
and prevent safe preview, publishing, or rollback. Existing names also conflate asset source IDs
such as `bil` with canonical authored IDs such as `industrial-district`.

## Decision

The editor produces immutable, content-addressed source revisions. A deterministic compiler turns
one source revision into a versioned runtime pack. Server and client systems consume shared pack
contracts and every multiplayer room is pinned to exactly one pack revision for its lifetime.

Asset source IDs, canonical world IDs, UUID entity IDs, human-readable slugs, display names, and
revision hashes are separate fields. UUIDs own references. Slugs and display names do not.

Local Play Draft revisions are stored in the shared tools IndexedDB and may be loaded in a fresh
tab. This local mode is a presentation and collision feedback loop, not an authoritative
multiplayer substitute. Authoritative previews compile on the server and create a revision-pinned
playtest room through the normal game runtime.

Converted map art remains source-owned. Building interiors are represented as authored overlays:
adopted building footprint, room shell, paired portal, collision override, fixtures, services,
replication space, and exact roof-occluder group. The compiler joins these into runtime packs.

## Consequences

- Editor drafts can be played before repository files or production data change.
- All clients in a room share a single immutable world contract.
- Published revisions can be reviewed, cached, rolled back, and retained independently.
- Interior authoring can move out of hardcoded catalogs without moving simulation into React.
- A compiler and compatibility adapters are required before all current runtime systems can stop
  loading fixed files.
- Schema and compiler versions become deployment compatibility gates rather than informal notes.

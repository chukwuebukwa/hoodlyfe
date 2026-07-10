# Debug Projection and Observability Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

The GTA III/Vice City code separates runtime diagnostics from gameplay ownership.

- `CDebug` owns a bounded set of formatted debug lines and drawing state. Gameplay code can report information without the world/session loop becoming the formatter.
- `CEventList` owns a bounded event registry with event type, entity references, position, lifetime, and response metadata. Producers add facts; consumers decide reactions.
- `CReplay` owns recording/playback buffers and the capture cadence for peds, vehicles, cameras, particles, and timing. Replay state is not mixed into entity behavior.
- Population, paths, cars, peds, weapons, and scripts expose counters/state that debug surfaces read; the debug surface does not become authoritative gameplay state.

References:

- [`Debug.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Debug.h)
- [`Debug.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Debug.cpp)
- [`EventList.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/EventList.h)
- [`EventList.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/EventList.cpp)
- [`Replay.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Replay.h)
- [`Replay.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Replay.cpp)

The reference is used to study boundaries only. NOCK0 remains an original TypeScript implementation.

## NOCK0 Extraction

`DebugSnapshotController` becomes the owner of developer snapshot projection:

1. Consume the typed events drained after a simulation frame.
2. Convert events to bounded human-readable history without changing the source facts.
3. Sample clock, state counts, spatial/lifecycle pressure, incidents, and pursuits at a fixed lower cadence.
4. Project only plain protocol data and publish it through a room-supplied transport callback.
5. Remain disabled in production unless explicitly enabled.

`DistrictRoom` drains the event stream and passes the immutable frame events to this projector. It no longer formats events, retains debug history, shapes debug protocol records, or decides debug cadence.

Snapshot transport is opt-in. `DebugSnapshotSubscription` installs the browser handler before sending `debug.subscribe`, and removes the handler after sending `debug.unsubscribe`. `DistrictRoom` publishes only to subscribed session IDs and removes subscriptions on leave. This prevents early-message warnings and avoids paying per-client debug bandwidth for clients that never open the developer surface. Authentication and production role authorization remain required before debug can be enabled outside local development.

## Required Production Nuance

- Developer snapshots, structured logs, metrics, traces, audit records, anti-cheat evidence, analytics, and deterministic replays are separate products with different retention and privacy policies.
- Debug access is authenticated and role-gated. Production clients must not receive hidden players, mission internals, anti-cheat signals, wallet/account identifiers, or server-only coordinates.
- High-cardinality identifiers stay out of ordinary metric labels; use structured logs/traces for entity IDs.
- Snapshot cadence and history are bounded independently of simulation rate, client count, and event volume.
- Event overflow, dropped simulation time, deferred queue pressure, room tick duration, patch size, socket backpressure, entity counts, and command rejection rates need metrics/alerts.
- Structured records include district/room ID, deployment version, tick, simulation time, correlation ID, and schema version.
- Replay capture records validated commands, deterministic seeds/content versions, important lifecycle events, and periodic state hashes; it must be reproducible headlessly.
- Redaction happens before transport or persistence, not only in the client UI.
- Debug projection failure cannot block or mutate the authoritative simulation.
- On-chain/economy observability must use transaction/outbox IDs and append-only ledger facts without exposing signing material or private account data.

## Acceptance Tests for This Extraction

- Disabled projection stores and publishes nothing.
- Events are summarized in order and history remains bounded to eight entries.
- Snapshots publish every six ticks, not every simulation step.
- Snapshot counts, queue pressure, incidents, pursuits, and event count reflect supplied authoritative sources.
- Protocol projection returns copies rather than mutable domain records.
- Existing browser `F3`/DBG view still shows live counts, incidents, pursuits, and recent events.

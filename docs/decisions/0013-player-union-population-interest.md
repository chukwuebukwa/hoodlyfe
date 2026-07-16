# ADR 0013: Player-Union Population Interest

**Status:** Accepted
**Date:** 2026-07-15

## Context

The district owns 144 potential ambient pedestrian and traffic records. Fully simulating
all of them would spend AI, collision, traffic, replication, and interaction-island work on
actors no player can observe. The earlier materialization policy also admitted records
anywhere inside its outer radius, including positions already visible to a player, while a
separate bootstrap population remained permanently active.

Single-player re3/reVC solve this with camera- and distance-aware generation, hysteretic
cleanup, pool budgets, and relevance protections. A multiplayer server must protect the
union of every player's interest rather than one local camera.

## Decision

- Streaming owns all disposable moving ambient pedestrians and traffic; bootstrap owns only
  persistent parked/service vehicles in the live room.
- Interest is the nearest distance to any valid street-player anchor.
- `0..720` pixels is protected hot space. Existing actors remain, but dormant records may
  not materialize there.
- `720..1,280` pixels is inside replication admission and is the only ambient
  materialization tier. This lets the client receive a full actor before presentation.
- `1,280..1,536` pixels retains existing actors as AOI hysteresis but admits no new actors.
- Beyond 1,536 pixels, disposable actors dematerialize into compact virtual records.
- Cold records advance coarse route/wander state every three seconds and do not participate
  in full AI, physics, replication, prediction, rewind, or interaction islands.
- Gameplay-owned or engaged actors fail closed and remain authoritative.
- F3 exposes hot, warm, cold, pop-guarded, pinned, and retired counts.

## Consequences

District cost scales with merged player interest rather than total potential population.
Actors prewarm before entering client replication, while all players protect nearby state.
The retained outer ring prevents activation churn.

The current active ceilings are room-global, so distant player clusters can compete for
population. Zone profiles, cluster quotas, extra gameplay anchors, and durable ownership
virtualization remain future work. The server also uses a conservative 720-pixel radial
guard because it does not yet consume a trusted camera-frustum hint.

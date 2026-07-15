# ADR 0011: Invisible Ambient Traffic Jam Retirement

**Status:** Accepted  
**Date:** 2026-07-15

## Context

Ambient traffic is a streamed population, but collision damage previously pinned a vehicle
indefinitely. A live central-junction probe found 17 stationary streamed cars with minor
ambient collision damage. All were outside active gameplay after the player left, yet all
remained authoritative because damage made them ineligible for ordinary dematerialization.

The street replication policy retains an already-visible entity through 1,536 pixels, while
ordinary population dematerialization begins at 1,920 pixels. A stalled ambient car could
therefore be invisible to every client but remain simulated and continue blocking a route.

## Decision

Population streaming owns a separate, deterministic jam-retirement policy:

- a candidate must be ambient streamed traffic and stationary for at least 18 seconds;
- it must be farther than the 1,536-pixel replication exit radius from every street player;
- it must be blocked by traffic, pedestrians, world geometry, or have stopped followers;
- occupied, hijacked, mission-targeted, burning, and destroyed vehicles are never eligible;
- minor collision damage does not protect an otherwise disposable offscreen ambient car;
- candidates with the most blocked followers retire first, with stable tie-breaking;
- at most two retire per pass, and passes are separated by a one-second cooldown;
- the virtual record advances three route steps before it can materialize again.

Retirement uses the existing population and traffic release paths, including spatial-index
removal. F3 population diagnostics expose a cumulative jam-retirement count.

## Consequences

Offscreen deadlocks can no longer pin damaged ambient traffic forever or consume simulation
capacity. Visible cars do not pop out, and gameplay-owned cars preserve state. This policy
is pressure relief, not visible-junction arbitration: strongly connected blocker detection
and deterministic reverse/yield recovery remain G2c work.

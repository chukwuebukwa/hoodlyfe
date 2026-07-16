# ADR 0016: Zone and Time Population Profiles

**Status:** Accepted
**Date:** 2026-07-15

## Context

ADR 0013 virtualizes disposable population around player interest, ADR 0014 prewarms at
vehicle speed, and ADR 0015 fairly divides global capacity among disconnected player
clusters. The potential records are still uniform, so every district area feels alike and
the world clock does not affect street life.

Pinned re3/reVC keep day/night population data in zones, interpolate it by time, then let
pedestrian and traffic managers consume the result beneath global caps. Their single-player
focus and content data are not directly usable in a multiplayer browser game.

## Decision

- Author original district zone profiles as content, separate from lifecycle code.
- Resolve and blend profiles in a pure deterministic policy.
- Apply profile density and composition only to dormant admission and bounded offscreen
  convergence. Never rewrite a visible active actor.
- Keep player-interest clusters and global safety ceilings outside profile policy. Zone
  density can reduce local demand but cannot allocate more capacity or create per-player
  copies.
- Keep wanted-response police and mission actors outside ambient profile selection.
- Preserve all existing gameplay pin rules during profile convergence.
- Expose world time, blend, active zone mix, held candidates, and convergence counts in F3.
- Keep the implementation server-only. Prediction, reconciliation, rewind,
  interaction-island replay, and shared collision kernels do not depend on zone profiles.

## Consequences

Street population now varies by place and time while remaining bounded and multiplayer
fair. Day-to-night changes converge over several ticks outside every protected view instead
of causing visible despawns. Additional archetypes, schedules, polygon zones, weather, and
gameplay anchors can extend the content/policy contracts without enlarging `DistrictRoom` or
changing netcode.

# ADR 0021: Owner-Scoped Roadblocks and Lane Closures

Date: 2026-07-18

Status: Accepted for G3c

## Context

Roadblocks are temporary systemic set pieces. Treating them as special traffic cars would
allow ambient routing to enter the barricade, while embedding closure logic in police
pursuit would conflate response allocation, world content, routing, and actor lifecycle.
Deployment must also avoid visible pop-in and preserve any barricade car a player hijacks.

## Decision

Use four explicit owners:

- the lane-graph document owns authored roadblock opportunities and validates their edges
  and vehicle poses;
- `RoadClosureRegistry` owns dynamic edge admission by stable owner ID and supports
  overlapping claims;
- traffic route/spawn systems consume closure admission without knowing police policy;
- `PoliceRoadblockController` owns eligibility, reservation, actor IDs, breach, retirement,
  typed events, and diagnostics.

The controller closes routes before spawning actors, waits for active traffic and protected
views to drain, and creates ordinary authoritative police vehicles. Occupied or hijacked
vehicles leave its ownership instead of being deleted. Stingers are a separate lifecycle.

## Consequences

- Traffic can replan around a set piece before it physically appears.
- Police response allocation cannot assign parked barricade cars as pursuit units.
- Cleanup cannot delete player-controlled cars or reopen overlapping closures early.
- Missions and future construction/crash systems can reuse owner-scoped closures.
- Authored content must provide viable alternate routes; F3 exposes closed edges and phases.
- The multiplayer prediction stack remains unchanged and consumes barricade cars through
  the existing authoritative actor and interaction-island contracts.

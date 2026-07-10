# ADR 0003: Reference-First Gameplay Development

Date: 2026-07-10

Status: Accepted

## Context

GTA-like systems contain behavior that is easy to miss when implemented from feature names alone. "Vehicle health" actually spans durability, localized components, impulse scaling, handling degradation, effects, AI reactions, fire timing, proof flags, repair, attribution, and mission policy. Similar hidden depth exists in police, pedestrians, traffic, weapons, missions, economies, properties, and online social systems.

Shallow implementations create rework and make the game feel unlike its references even when the visible checklist is complete.

## Decision

Every substantial gameplay domain follows a reference-first gate before implementation:

1. Identify at least one mature production implementation, proven domain library, official design document, or authoritative research source.
2. Record the exact source/version, license constraints, observed invariants, edge cases, state transitions, and tuning relationships.
3. Separate transferable behavior from engine-specific or legally unusable implementation details.
4. Write a NOCK0 adaptation for 2D presentation, deterministic server authority, multiplayer fairness, latency, anti-cheat, persistence, and future area-of-interest scaling.
5. Convert the important behaviors into headless tests and debug-visible state.
6. Implement behind a domain boundary, run integration and browser QA, then record the result in the timestamped devlog.

When no suitable implementation is available, document that gap and build the smallest reversible experiment. Do not present an unresearched placeholder as a finished production system.

## Source Policy

- Prefer permissively licensed source, proven libraries, official documentation, standards, and research papers.
- Treat unlicensed reverse-engineered source as read-only behavioral reference.
- Do not copy incompatible code, assets, identifiers, data tables, or structure.
- Cite the source snapshot so later developers can reproduce the analysis.

## Consequences

- Up-front research takes time but reduces systemic rework.
- Features gain explicit behavioral acceptance criteria before code grows.
- Debug tools must expose decisions and transitions, not only entity counts.
- Devlog entries explain both what changed and which production nuance motivated it.
- The project remains original while learning from mature systems.

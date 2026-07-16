# ADR 0010: Predictive Traffic Contact Policy

Date: 2026-07-15

Status: Accepted for G2b.2a

## Context

Directed lanes and serialized junction ownership prevent many route conflicts, but the
traffic awareness layer still represented vehicles as circles in a forward strip. It could
miss angled rectangle contact and falsely brake for a clear adjacent lane. Authoritative
collision resolution occurred after movement, so late awareness could still create a chain
of stopped or overlapping cars.

Traffic policy must remain separate from the interaction-island netcode and physical contact
solver. The client must not run ambient AI during prediction or replay.

## Decision

Add a server-only predictive contact module using continuous separating-axis intervals for
fixed-orientation, translating oriented boxes. Feed it vehicle dimensions from the shared
catalog and velocity from the current authoritative traffic snapshot.

Traffic awareness combines its TTC-derived speed cap with existing following, pedestrian,
and signal caps. The minimum desired speed wins deterministically. It does not move actors,
resolve penetration, or mutate routes.

An active authored-junction owner ignores vehicles queued for the same junction because the
junction system already guarantees their stop-line behavior. This is explicit composition
between right-of-way policy and local collision prediction, not a general collision ignore.

Expose selected TTC through server diagnostics, the debug protocol, the F3 panel, and a
color-coded Three overlay. Extend the deterministic dense soak with real catalog-box overlap
bounds.

## Multiplayer Contract

Only the district server evaluates traffic TTC. Interaction-island replay receives the
resulting physical intent/state and continues to use the existing shared movement/contact
kernel. Prediction, reconciliation, AOI, history, rewind, remote timelines, and rollout
contracts are unchanged.

## Consequences

- Crossing and angled traffic brakes before its catalog footprints overlap.
- Parallel adjacent lanes no longer inherit the false width of circular vehicle proxies.
- Junction throughput remains owned by the explicit admission state machine.
- Constant velocity and fixed orientation are short-horizon approximations; they are
  reevaluated every 30 Hz server step.
- Compatible simultaneous turn classes and general deadlock resolution remain separate
  milestones.

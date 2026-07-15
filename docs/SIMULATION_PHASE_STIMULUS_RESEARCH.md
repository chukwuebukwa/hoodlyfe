# Simulation Phase and World Stimulus Reference Study

Date: 2026-07-14

Status: G0 adaptation contract

## Pinned Sources

- re3 `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`
  - [`Game.cpp`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Game.cpp#L1012-L1103)
  - [`EventList.h`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/EventList.h#L6-L64)
  - [`EventList.cpp`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/EventList.cpp#L23-L237)
- reVC `b9eeb33efcd04a5b7a423921609baef11bf4719a`
  - [`Game.cpp`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Game.cpp#L844-L964)
  - [`EventList.h`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/EventList.h#L7-L67)
  - [`EventList.cpp`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/EventList.cpp#L23-L251)

These unlicensed reversed sources are read-only educational references. The NOCK0
implementation is original TypeScript and does not copy source, identifiers, tables, or
engine structure.

## Reference Findings

### Update order is a gameplay contract

Both games use an explicit top-level order rather than letting systems independently run
whenever convenient. Clock and weather precede scripts. Events, fire, population, and
weapons update before world physics. Pickups, garages, game logic, and traffic population
maintenance follow world processing.

reVC preserves the re3 shape while adding script paths, set pieces, ropes, more vehicle
pool maintenance, and a measured population-quality fallback when streaming work consumed
the frame budget. The exact C++ order is not a browser-server template, but it proves that
phase order, structural mutation points, and performance degradation are explicit policy.

### Perceptible events are bounded world facts

`CEventList` stores a bounded set of short-lived facts with type, related entity, criminal,
position, timeout, and lifecycle state. Registering the same semantic entity/type refreshes
the timeout instead of growing the list. Consumers query nearby facts without importing
the producer. Crime reporting is downstream translation from event type and police
presence, not an intrinsic side effect of every observer.

reVC expands the event vocabulary with explosion, nasty-weapon, and additional ambient
attractor events. It keeps the same bounded/deduplicated ownership model.

## NOCK0 Adaptation

### Three different fact lifetimes

1. `GameEventStream` is the authoritative ordered result stream for one completed fixed
   step. It feeds audio, missions, diagnostics, pickups, and world-stimulus translation.
2. `WorldStimulusRegistry` is bounded, expiring sensory context with stable IDs,
   provenance, source/subject/actor identity, spatial layer, intensity, radius, and
   perception channels.
3. `IncidentRegistry` is longer-lived crime/report evidence with witness, report, wanted,
   and police-response state.

They are related by adapters, not inheritance or direct cross-domain calls.

### Fixed-step phases

G0 preserves current behavior in these named phases:

1. `frame-state`
2. `simulation-activation`
3. `environment`
4. `vehicle-motion`
5. `player-motion`
6. `crime-response`
7. `pedestrian-motion`
8. `dynamic-contacts`
9. `history-capture`
10. `projectiles`
11. `world-effects`
12. `pickups`
13. `incidents-missions`
14. `lifecycle`
15. `event-dispatch`
16. `snapshot-observability`

Events produced during phases 1-14 are drained once in phase 15. World stimuli created
from those events become perceptible during the next fixed step because pedestrian
perception has already run. This one-tick boundary is intentional and prevents producer
order from changing which pedestrians react in the same tick.

### Initial vertical migration

G0 migrates the existing path:

```text
authoritative weapon fire
  -> GameEventStream weapon.fired
  -> WorldStimulusAdapter
  -> WorldStimulusRegistry gunshot
  -> next-tick pedestrian perception
  -> private NPC reaction intent
```

The same adapter also retains existing injury, death, impact, fire, and explosion facts.
The generalized contract enables later crime, police, mission, and audio consumers, but G0
does not broaden their behavior yet.

## Multiplayer and Netcode Rules

- G0 treats the interaction-island netcode as frozen infrastructure. The phase extraction
  preserves history and interaction-snapshot capture order but does not change prediction,
  reconciliation, interpolation, AOI, replay, rewind, rollout, or shared movement/contact
  algorithms.
- World stimuli are authoritative server state and are never client-predicted.
- Stimulus registration, expiry, crime translation, and AI reaction do not execute during
  interaction-island replay.
- The client receives stimuli only through the opt-in debug snapshot. Normal actor
  replication exposes the resulting authoritative action state, not private perception.
- Historical combat rewind resolves one bounded hit query and emits present-time results;
  it does not insert stimuli into a rewound timeline.
- One-shot presentation derives from deduplicated game-event IDs or authoritative entity
  state, never by replaying the world-stimulus registry.
- The additive debug protocol fields are sent only to explicit debug subscribers and do
  not participate in actor replication or interaction snapshots.

## Failure and Capacity Policy

- Phase execution is non-reentrant and fail-fast; the server does not continue a partial
  tick after a thrown phase.
- Each phase records runs, last tick, duration, maximum duration, and failures for opt-in
  diagnostics.
- World-stimulus capacity is fixed. Deterministic eviction removes the earliest-expiring,
  then oldest, then ID-lowest fact.
- Invalid positions, time, radius, intensity, lifetime, channels, or dedupe identity are
  rejected at registration.
- Same-space filtering prevents street facts from leaking into future interiors merely
  because coordinates overlap.

## Acceptance Criteria

- The room delegates fixed-step execution to one `DistrictSimulation` owner.
- The exported phase order is immutable, unique, and tested.
- Existing gameplay order, history capture, event drain, interaction snapshot capture, and
  debug publication remain behaviorally equivalent.
- The generalized world-stimulus registry passes capacity, refresh, scoring, same-space,
  channel, deterministic eviction, validation, and expiry tests.
- A fired weapon creates one gunshot fact regardless of pellet count; NPCs perceive it on
  the next tick, not before event dispatch.
- Debug snapshots expose phase timing/failures and generalized stimulus attribution.
- TypeScript, full tests, netcode tests, two-client integration, production build, and
  browser debug QA pass before checkpoint.

# Pedestrian Event Perception Research

Date: 2026-07-10

Primary behavioral references: re3 `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`
and reVC `b9eeb33efcd04a5b7a423921609baef11bf4719a`

## Production Findings

The reference game's `CEventList` is a bounded, short-lived world-fact registry rather than a direct combat-to-pedestrian callback chain.

- Facts include gunshots, injured/dead pedestrians, fire, theft, hit-and-run, and explosions.
- Each fact carries a type, position, related entity/offender, and expiry.
- Repeated facts for the same semantic subject refresh an existing slot instead of growing without limit.
- Expired entries are removed on a separate update pass.
- Pedestrian logic can ask for a nearby relevant fact without importing the system that produced it.
- Criminal reporting is downstream policy; registering a perceptible fact is not itself the wanted-level system.

References:

- [re3 `EventList.cpp`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/EventList.cpp)
- [reVC `EventList.cpp`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/EventList.cpp)
- [reVC `PedAI.cpp`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/PedAI.cpp)

The source was used only to identify observable behavior and ownership. NOCK0 uses an original TypeScript model, names, values, scoring, and tests.

## NOCK0 Contract

NOCK0 keeps three different concepts separate:

1. `GameEventStream` is the ordered, per-frame fact stream for systems and diagnostics.
2. `IncidentRegistry` is durable crime/reporting evidence used by witnesses, wanted heat, and police response.
3. `WorldStimulusRegistry` is bounded, ephemeral sensory context shared through narrow
   queries; pedestrian perception is its first consumer.

`WorldStimulusAdapter` converts stable game events into attributed sensory facts. Each fact
records source, subject, responsible actor, spatial layer, intensity, radius, perception
channels, and originating event type. It currently maps:

- one `weapon.fired` fact per trigger pull to `gunshot`, regardless of projectile/pellet count;
- non-weapon `vehicle.damaged` facts to `impact`;
- `damage.applied` and `entity.killed` to `injury` and `death` at the authoritative entity position;
- `vehicle.ignited` and `vehicle.destroyed` to `fire` and `explosion`.

Weapon damage does not also become an impact, preventing one shot from producing two equivalent reactions. Semantic source/subject keys refresh rapid repeated facts. Capacity eviction is deterministic and prioritizes the fact with the earliest expiry.

## Perception and Behavior

- Stimulus lookup is capped by a 128-entry registry, requires the same spatial layer and
  a matching hearing/sight channel, then scores intensity against distance.
- Pedestrians use staggered 240 ms perception updates while locomotion remains fixed-step.
- A perceived fact is copied into private expiring memory; behavior never holds a registry object reference.
- High-severity facts make civilians flee. Braver civilians may investigate a low-severity collision instead of reacting identically.
- Unassigned police investigate sensory facts. Dispatch pursuit remains higher priority and preserves its own line-of-sight/fire rules.
- Explicit personal threats remain higher priority for civilians; police approach a known attacker rather than inheriting civilian flee behavior.

## Required Follow-Up Nuance

- Move stimulus tuning into validated pedestrian/weapon/vehicle content data as the content pipeline matures.
- Add line-of-sight attenuation, wall/indoor layers, vehicle cabin attenuation, and distinct visual versus audible facts.
- Add archetype awareness, bravery, aggression, faction, and weapon-skill profiles rather than one randomized bravery value.
- Protect perception work with per-tick budgets as ambient population scales beyond the current district.
- The initial look/respond/recover behavior phase is documented in `docs/PEDESTRIAN_REACTION_RESEARCH.md`. Later phases still need call police, take cover, assist, retaliate, arrest, and containment states.

## Debug Inspection

The opt-in F3 snapshot includes pedestrian objective, bravery, personal threat, stimulus
kind/source/expiry, every active world stimulus with attribution/provenance, and the named
server phase timings. The client draws stimulus center/radius. This diagnostic payload is
not ordinary synchronized entity state and is delivered only to explicit debug subscribers.

## Acceptance Coverage

- Registry capacity, semantic refresh, intensity-distance selection, same-space/channel
  filtering, deterministic eviction, validation, defensive copies, and expiry.
- Event-to-stimulus mapping for combat, collisions, fire, and explosions without duplicate weapon impacts.
- One gunshot event per firing action, including multi-pellet weapons.
- Perception staggering and memory expiry.
- Bravery-scaled civilian investigate/flee choices and police investigation.
- Existing multiplayer combat, witness, wanted, police, traffic, mission, vehicle damage, death, and respawn scenarios remain green.

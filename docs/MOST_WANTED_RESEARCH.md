# Most Wanted Eliminate-Target Research

Date: 2026-07-11

Primary reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

## Production Findings

Vice City separates a scripted kill contract into distinct owners:

- script commands resolve concrete pedestrian handles, clear the scripted-completion flag, and assign `OBJECTIVE_KILL_CHAR_ON_FOOT` or `OBJECTIVE_KILL_CHAR_ANY_MEANS`;
- pedestrian AI owns leaving vehicles, target validity, weapon range, cover/duck behavior, pursuit, vehicle targeting, line-of-sight fire, melee distance, and combat state;
- the pedestrian objective completes when its referenced target is dying/dead or has nonpositive health;
- mission cleanup tracks script-created actors independently from objective execution;
- player threat queries inspect the actor's objective and referenced target rather than inventing a second combat relationship.

References:

- [`Script2.cpp` scripted objective assignment](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script2.cpp#L1171-L1208)
- [`PedAI.cpp` kill-objective execution and completion](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedAI.cpp#L922-L1020)
- [`PlayerPed.cpp` target relationship query](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PlayerPed.cpp#L568-L580)

NOCK0 borrows the ownership split, not source code or mission content.

## NOCK0 Contract

`Most Wanted` is a fifth Freemode template built from reusable systems:

- `MissionSystem` owns roster, deadline, objective progress, terminal state, and payout eligibility.
- `MissionObjectiveSystem` consumes only `encounterComplete` for `eliminate-target`; it does not inspect NPC health or apply damage.
- `MissionEncounterSystem` owns bounded guard/target spawning, stable actor IDs, living-roster scaling at wave start, target assignment, contribution facts, and cleanup identities.
- Pedestrian combat, navigation, fire control, melee, projectiles, and damage retain all combat execution.
- `MissionEntityScope` guarantees every mission actor is removed on completion, failure, timeout, or abandonment.
- Replication pins the marked target only for mission participants; guards retain ordinary AOI behavior.
- Phaser and Three consume the same replicated target ID for world/minimap markers and never select a target locally.

## Playable Rules

- Up to four nearby players opt in and the leader explicitly launches.
- A hideout is selected at a collision-safe point away from the contact.
- Wave one spawns two guards plus one extra guard for each additional living participant.
- Wave two spawns one marked boss with 220 health, an SMG, and a faster fire cadence.
- The crew receives $1,500 each only after encounter completion through existing idempotent mission payouts.
- Individual death does not fail the job; disconnect, timeout, abandonment, and terminal cleanup keep existing Freemode semantics.

## Acceptance Coverage

- Catalog validation permits at most one single-count target wave and bounded roster scaling.
- Guard count scales from living participants deterministically.
- The target actor ID is stable, replicated, presented, and not inferred from generic hostiles.
- Eliminate-target remains active until authoritative encounter completion.
- Room adaptation spawns guards and boss, pays each crew member once, and removes all actors.
- A target beyond normal street AOI remains visible to participants but not unrelated players.

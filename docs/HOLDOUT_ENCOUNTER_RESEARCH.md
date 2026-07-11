# Crew Holdout and Mission Encounter Research

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

Product references: Rockstar Games Survival and Survival Creator descriptions.

## Production Findings

The useful production pattern is not a monolithic survival loop. Mission state, mission actors, pedestrian combat objectives, weapon damage, counters, and cleanup remain separate owners.

- Created mission pedestrians are explicitly marked, excluded from ambient threat/revival behavior, placed through world-space clearance, and registered in bounded mission cleanup.
- Script commands assign kill objectives to pedestrian AI rather than moving or firing the actor from mission code.
- Kill-frenzy state owns bounded target filters, required kills, timer, pass/fail, presentation counters, temporary loadout restoration, and explicit death behavior. Damage systems emit kills; they do not increment mission state directly.
- GTA Online Survival uses authored spawn points, combat proficiency, vehicle/prop options, finite escalating waves, crew play, and between-wave loadout opportunities. Those are content/encounter policies, not reasons to couple mission progress to weapon internals.

References:

- [`Darkel.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Darkel.cpp)
- [`Script.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script.cpp)
- [`Script2.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script2.cpp)
- [Rockstar Survival Creator](https://www.rockstargames.com/newswire/article/9k1248838o2a2a/Create-Your-Own-Survival-and-King-of-the-Hill-Modes-in-GTA-Online)
- [Rockstar Survival overview](https://www.rockstargames.com/gta-online/series-modes/survivals)

NOCK0 uses original TypeScript contracts, names, wave values, routes, visuals, and tests. The references identify ownership and missing production nuance only.

## Encounter Ownership

`MissionEncounterSystem` owns only encounter runtime:

- bounded immutable wave definitions;
- one actor spawn at most per update and explicit spawn cadence;
- current/pending actor identity, inter-wave delay, and completion;
- nearest connected living roster target assignment;
- kill-event contribution and deterministic snapshots;
- actor ownership returned for terminal cleanup.

It receives narrow ports for actor spawn, actor state, and target assignment. It does not import district schema, pedestrian movement, navigation, fire control, damage, wanted state, economy, Colyseus, or Phaser.

`MissionEntityScope` remains the cleanup registry. Every hostile is tracked as a mission NPC. Completion, timeout, abandonment, and eventual mission removal clear combat targets and despawn actors immediately; dead mission actors never enter ambient respawn.

## Hostile Pedestrian Boundary

`PedestrianCombatSystem` converts one assigned target into line-of-sight pursuit, stop distance, aim, and rate-limited fire intent. Existing navigation and locomotion execute movement. `PedestrianController` owns mission actor creation, private weapon/cooldown state, target assignment, non-respawn lifecycle, and despawn.

Hostile bullets use the ordinary authoritative projectile path and can hit players or vehicles. Their attacker ID is preserved in damage/kill events, but the non-player disposition prevents street crime, wanted heat, civilian/police kill rewards, panic, and ambient respawn. This keeps mission payout in the economy port and makes F3 event history truthful.

The current hostile appearance deliberately reuses private compatibility art under a separate `hostile` presentation key with a red assault tint. Stable gameplay identity does not depend on that source texture.

## Hold Objective

The pure `hold-area` evaluator receives participant snapshots, elapsed time, authoritative hold geometry, contested state, and encounter completion. Progress:

- accrues at most one second per update;
- requires at least one connected living crew member inside the zone;
- pauses while a living mission hostile occupies the zone;
- survives individual death/respawn and does not reset on temporary absence;
- completes only after both 25 defended seconds and all waves are clear.

Participant contribution time is tracked separately from general active time. Crew Holdout requires five seconds in the zone for payout eligibility, excluding a connected idle participant without changing completion for contributing teammates.

## Crew Holdout Content

- Three waves: 2 pistol attackers at 60 health, 3 pistol attackers at 75 health, then 4 SMG attackers at 90 health.
- 350 ms bounded spawn cadence and 1.6 second inter-wave delay.
- 140-unit hold zone, 25 defended seconds, 180-second overall deadline.
- Fixed $1,200 idempotent payout per eligible connected participant.
- Live HUD exposes overall timer, defended state, wave, remaining attackers, contest state, and payout.
- World/minimap expose the hold boundary and active hostile markers; F3 exposes hostile target, route, fire, damage, kill, and mission hold/wave state.

## Acceptance Coverage

- Wave order, spawn budget, nearest target assignment, kill contribution, contest detection, completion, and cleanup are deterministic.
- Hold time rejects absent/dead crew, pauses when contested, caps elapsed work, and waits for encounter completion.
- Mission hostiles pursue, navigate, fire at their configured cadence, remain dead, and despawn.
- Hostile death grants no street cash or crime; hostile player damage preserves attacker identity without wanted/reward side effects.
- The room adapter spawns and defeats all nine actors, advances 25 defended seconds, pays once, and removes every mission NPC.
- Full suite passes 122/122 and the production TypeScript/Vite build passes.
- Live desktop and 390x844 QA verifies two real hostile attackers, vehicle/player damage, player death with mission continuity, F3 events, hold/world/minimap presentation, clean abandonment, fitted text, viewport reset, and zero new warning/error logs.

## Deferred Production Depth

- Authored tactical spawn sets with visibility, cover, route, and minimum-player-distance scoring.
- Per-wave archetypes, armor, accuracy/recoil, weapon drops, resupply breaks, vehicles, melee/rushers, and boss roles.
- Downed/spectator/rejoin policy, shared lives, late joins, wave restart checkpoints, and disconnect grace.
- Friendly mission actors, escort/defend targets, cover selection, squad tactics, suppression, and difficulty scaling by roster size.
- Persistent job statistics, medals, matchmaking, and durable rewards after identity/ledger work.

The next gameplay slice should return to vehicle/police depth or the hospital/clothing service loop. Encounter content should expand only after authored tactical spawn metadata exists; adding larger raw wave counts would increase pressure without increasing quality.

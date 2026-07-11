# Target-Free Crew Checkpoint Mission Research

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference keeps race/checkpoint content inside mission-owned data while player, vehicle, path, marker, timer, and pickup systems retain their own state.

- Script spheres have explicit add/remove ownership, bounded storage, and generation-checked handles. Rendering reads active marker records without deciding mission progress.
- Locate commands distinguish any-means, on-foot, in-car, and stopped predicates. A checkpoint can therefore require the intended actor state instead of accepting any entity overlap.
- Race pickup routes are ordered authored positions terminated by an explicit sentinel. Their visual objects are non-colliding mission objects and are cleaned separately from vehicle physics.
- Closest-car-node commands place route work on the road graph. Mission scripts do not implement steering or collision.
- On-screen timers and counters are independent presentation channels over mission variables.

References:

- [`Script4.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script4.cpp)
- [`Script5.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script5.cpp)
- [`Pickups.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Pickups.cpp)
- [`Script3.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script3.cpp)

NOCK0 uses original TypeScript contracts, route generation, names, formulas, visuals, and tests. The reference is used only to identify production ownership and missing predicates.

## Implemented Boundary

Mission templates now declare two policies independently of objective order:

- `targetMode`: reserve an ambient traffic vehicle or evaluate crew members directly;
- `rewardPolicy`: reduce payout by target condition or use a fixed bounded reward.

`MissionSystem` reserves, validates, fails, scores, and cleans a target only when the template requests one. A target-free job stores no fake target ID, creates no mission entity record, ignores target destruction, and cannot collide with the target reservation map.

The pure `crew-checkpoints` objective receives narrow participant snapshots: connection, life state, authoritative vehicle identity, and effective world position. Any connected living participant in an existing vehicle can advance the shared ordered route. Walking, dead, disconnected, invalid-vehicle, or out-of-order participants cannot advance it.

`FreemodeMissionController` remains the adapter. For each participant it resolves an existing vehicle and uses the vehicle position before falling back to the on-foot player position. The mission evaluator never reads district state, Colyseus schema, vehicle simulation, traffic AI, Phaser, or economy internals.

## Crew Checkpoint Rush

- nearby opt-in Freemode crew formation and explicit/automatic roster lock;
- five deterministic collision-safe road checkpoints;
- any crew vehicle can carry shared progress, including a vehicle driven by a support player;
- no marked target, target reservation, delivery zone, or condition reward;
- 150-second active timer and fixed $900 payout per eligible connected participant;
- individual death tolerance, deterministic leader transfer, abandonment, timeout, idempotent payout, terminal retention, and cleanup reuse the existing mission runtime.

Only the current checkpoint is replicated. The future route remains server-private. World and minimap presentation show one route marker and never synthesize a missing target marker.

## Acceptance Coverage

- Catalog target/reward policies are finite and all three templates cycle deterministically.
- Crew route requires an alive connected participant in a valid vehicle.
- Ordered progress cannot skip later checkpoints.
- Target-free work starts with no traffic vehicles, survives missing/destroyed target fields, and reserves no empty target key.
- The room adapter generates five unique occupiable road checkpoints and pays $900 after an arbitrary crew vehicle completes them.
- HUD copy, current world checkpoint, minimap marker, fixed reward, offer/launch/abandon actions, and target absence are covered by pure presentation tests.
- Focused mission suite passes 19/19; full suite passes 115/115; production TypeScript and Vite build pass.
- Live desktop and 390x844 QA verify offer, launch, timer, objective marker count, full title fit, no text overflow, abandonment cleanup, viewport reset, and zero new warning/error after a clean reload.

## Next Mission Boundary

Holdout remains next because it proves a different contract: authored hostile-wave ownership, contested presence, survival time, combat-event contribution, respawn tolerance, and explicit wave cleanup. It must subscribe to combat/lifecycle facts rather than polling or mutating damage internals. A passive timer with endlessly respawning ambient police is not an acceptable implementation.

Delivered later the same day in `HOLDOUT_ENCOUNTER_RESEARCH.md` and the Crew Holdout job.

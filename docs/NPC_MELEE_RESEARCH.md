# NPC Melee Combat Research

## Purpose

NOCK0 already has ranged police and mission-hostile pursuit, timed player melee, armor, and synchronized hit reactions. The missing close-range transition makes armed AI fire through a target at point blank and gives pedestrians no authoritative strike state. This note defines the first production-shaped NPC melee slice without moving combat policy into locomotion or `DistrictRoom`.

## Pinned Production Reference

The primary reference is the GTA III re3 source in `daynz/GTAviceCity`, pinned at commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

- [`CPed::SetAttack`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedFight.cpp) chooses ordinary weapon attack versus unarmed fight and converts point-blank gun encounters into a fight attack.
- [`CPed::Fight`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedFight.cpp) owns target-facing move choice, movement lock, animation contact windows, one strike application, recovery, and return to the previous objective.
- [`CPed` objective combat](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedAI.cpp) separates target/range decisions from attack execution and keeps pursuing when the target is outside the selected weapon range.
- [`CCopPed` pursuit](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp) selects unarmed behavior at low wanted pressure and invokes the same attack state rather than applying cop damage directly from pursuit code.

OpenGTA2 remains useful for compatible map and presentation assets but does not expose an implemented pedestrian fight system to reuse. No original code or timing table is copied.

## Production Behavior Worth Preserving

### Objective, approach, and attack are separate

The AI objective retains victim identity. Distance and weapon policy decide whether the pedestrian approaches, aims, or enters a fight. The fight state does not discover a new arbitrary victim every frame, and locomotion does not apply damage.

### Point-blank gun fallback

re3 explicitly detects a pedestrian too close for an instant-hit weapon and starts a fight attack. This avoids muzzle clipping and creates a readable close-range response. NOCK0 should use the same transition for visible pursuing police and mission hostiles, while retaining their ranged weapon outside the melee envelope.

### Contact is an animation event

An accepted strike has a windup, one legal contact window, and recovery. Contact geometry is evaluated at that moment. Merely remaining near a victim never deals damage every simulation tick.

### Distance and facing remain authoritative

re3 selects shuffles, punches, kicks, and heavier moves from victim distance, facing, ground state, and pedestrian traits. The first NOCK0 slice keeps one punch but preserves the underlying contract: fixed victim, bounded reach, forward arc, line of sight, and impact-time revalidation.

### Reactions interrupt lower-priority action

Fight state is subordinate to damage, knockdown, death, and invalid objectives. NOCK0's existing `CombatReactionController` is therefore the interruption boundary. A reacting NPC cannot continue a hidden strike timer and apply delayed damage.

## NOCK0 First-Slice Contract

### Eligibility

- Only visible pursuing police and mission-owned hostiles with an assigned living player may start NPC melee.
- Attacker and victim must be alive, on the street, unobstructed, and the victim must be on foot.
- Point-blank selection suppresses ranged fire for that decision.
- Spawn protection remains authoritative in `DamageController`; an attacker may animate but protected contact applies no damage.

### Timing and tuning

- Center-distance engagement envelope: `52 px`, matching player fist reach plus actor radii.
- Strike duration: `520 ms`.
- Contact time: `210 ms`.
- Recovery cooldown after the strike: `420 ms`.
- Damage: `8`, medium-force melee, one victim maximum.
- Impact-time validation: target identity, life, space, vehicle state, `52 px` distance, `0.72 rad` half arc, and world line of sight.

These values make a lone attacker threatening but readable: the 25-point development vest absorbs three full punches and part of a fourth, while the synchronized medium reaction communicates each accepted hit.

## Ownership

- `PedestrianCombatSystem` chooses approach, ranged fire, or point-blank melee against an existing target.
- `PedestrianMeleeSystem` owns private per-NPC strike phase, accepted victim, timing, one-contact identity, impact validation, cooldown, replicated attack progress, interruption, and damage requests.
- `PedestrianController` composes decision, melee, navigation, locomotion, and fire. It does not contain strike math.
- `DamageController` remains the only armor/health/lifecycle mutation boundary. NPC attacks use non-player disposition, so they never create player crime, wanted heat, or kill cash.
- `NpcState` carries presentation facts only: attack sequence, normalized progress, and `action = melee`.
- One renderer-neutral policy turns replicated progress into the same body pose in Phaser and Three.
- `DistrictRoom` only injects the narrow damage adapter already used by other combat producers.

## Explicit Deferrals

- Civilian retaliation, gangs, bravery-driven fight-or-flight, and NPC-versus-NPC fights.
- Kick/headbutt selection, combos, blocking, ground attacks, grapples, and arrest animations.
- NPC baseball bats or durable NPC weapon inventory.
- Vehicle occupant extraction and attacking occupied vehicles.
- Audio and authored original strike sprite frames.

Those are content and behavior expansions on the same runtime, not reasons to bypass it now.

## QA Contract

- Pure decision tests cover approach, fire, point-blank melee, LOS, vehicle, and cooldown gates.
- Melee runtime tests cover timing, one contact, miss-after-displacement, arc/LOS rejection, reaction cancellation, recovery, and cleanup.
- Controller tests prove mission hostiles and police enter melee without firing and resume their objective afterward.
- Damage integration proves armor-before-health and non-player attribution.
- Renderer tests prove deterministic progress-only poses and reaction priority.
- The real multiplayer test observes an authoritative NPC melee sequence and synchronized player armor/health/reaction change.
- Desktop/mobile Phaser and Three browser QA must remain nonblank, overflow-free, and free of fresh errors.

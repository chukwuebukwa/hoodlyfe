# Melee Combat Reference Study

Updated: 2026-07-10

This note defines the production behavior NOCK0 should preserve when adding unarmed and baseball-bat combat. The primary reference is the GTA III `master` branch at `daynz/GTAviceCity`, commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`. The repository name is misleading for this branch: it contains the re3 GTA III source, not the Vice City `miami` branch.

NOCK0 borrows system boundaries and behavioral nuance, not source code or Rockstar content.

## Reference Findings

### Separate weapon and fight paths

- Unarmed stationary fighting enters a dedicated fight state through `CPed::StartFightAttack`, advances through `CPed::Fight`, and resolves contact in `CPed::FightStrike`.
- Baseball-bat and moving attacks use the general attack path: `CPed::SetAttack` -> `CPed::Attack` -> `CWeapon::FireMelee`.
- `FightMove` is data-driven and carries animation, active-window start/end, combo follow-on time, strike radius, hit level, damage, and flags.

References:

- [`Ped.h` fight data and runtime state](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Ped.h)
- [`PedFight.cpp` fight state and strike resolution](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedFight.cpp)
- [`Weapon.cpp` melee weapon contact](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/Weapon.cpp)

### Contact is a timed window

Unarmed damage is legal only while animation time is inside the move's `startFireTime` and `endFireTime`. A `JUST_ATTACKED` state prevents the same move from applying contact twice. Held melee crosses one configured animation fire frame before resolving contact. Contact slows the source animation briefly, then recovery completes.

The browser adaptation therefore needs:

- server-owned windup, impact, and recovery timestamps;
- one stable attack/contact identity per swing;
- no client animation callback deciding whether damage happened;
- a replicated sequence edge so clients can present every accepted swing.

### Target selection and contact are different

GTA III first selects and faces a move using distance/facing bands, then tests an animated limb or weapon contact point against victim collision spheres. Representative move-selection bands are:

| Move family | Distance | Facing error |
| --- | ---: | ---: |
| Knee/head | under 0.8 units | under 75 degrees |
| Close punches | under 1.3 units | under 55 degrees |
| Kick | under 1.7 units | under 35 degrees |
| Long kick | under 2.0 units | under 30 degrees |
| Forward shuffle | up to 3.0 units | narrow forward cone |

NOCK0 does not yet have skeletal limb collision, so its reversible approximation is a forward contact arc evaluated at the authoritative impact time. Candidates are scored by distance plus angular error, line-of-sight checked, and ordered deterministically.

### Combos and target caps

GTA III buffers player input after a move-specific combo time, but its `nPlayerInComboMove` is global because the original game is single-player. NOCK0 must keep combo memory per player.

Unarmed `FightStrike` stops after its first colliding pedestrian. `FireMelee` continues through nearby pedestrians, allowing a bat swing to contact more than one. NOCK0 will preserve that distinction with a one-target fist cap and a bounded bat multi-target cap.

### Damage and reactions

The source separates move damage, victim scaling, armor/proof checks, directional hit reactions, knockdown thresholds, and death. Bat hits are stronger and can trigger knockdown behavior. Every landed hit registers either assault or assault-police; witnesses and wanted policy remain separate systems.

NOCK0 already has the correct downstream owners:

- `DamageController` owns health, death, rewards, spawn protection, and assault facts.
- `CrimeResponseController` owns witnesses, incidents, reporting, and wanted heat.
- `PedestrianReactionSystem` consumes injury/death stimuli after contact.
- `VehicleSimulationController` owns any deliberate bat-to-vehicle adaptation.

The first slice will not add armor, knockdown, blocking, ground attacks, or NPC melee. Those require their own state and production study rather than hidden booleans inside the melee controller.

## NOCK0 Design

### Domain ownership

`MeleeCombatController` owns accepted swing runtime, per-player combo progression, impact timing, target scoring, target caps, and damage requests. `DistrictRoom` may construct it, dispatch the existing primary-attack intent, update it in the fixed schedule, and route its narrow damage ports. It must not own melee geometry or tuning.

### Shared content

The weapon catalog becomes the single source for stable weapon IDs, weapon families, ammo ownership, combat timing, melee strike definitions, and presentation metadata. Fists and bat are available to every development player for now; future acquisition belongs to private inventory, not cycling code.

### First-slice rules

- Fists use a three-step per-player combo with distinct windup, recovery, reach, and damage.
- Bat uses one slower swing, wider reach, stronger damage, and a bounded multi-target cap.
- Both are on-foot only and have no ammunition cost.
- A nearby eligible target can gently correct facing when the swing starts.
- Damage resolves once at the strike's impact time, never at input receipt.
- Street-only combat remains explicit until interior projectile/melee obstruction and witness policy are authored.
- Bat-to-vehicle damage is a deliberate top-down adaptation and remains low relative to firearm/vehicle health; fists do not materially damage vehicles.
- A melee swing emits a distinct event. It must never become a gunshot stimulus; a landed hit already creates injury/death stimuli.

## Required Evidence

- Pure policy tests for front/behind/range/occlusion ordering and target caps.
- Controller tests for impact timing, one-contact identity, combo reset/progression, ammunition invariance, player/NPC/vehicle routing, and cleanup.
- Fire-control tests proving melee dispatch creates no bullets or thrown projectiles.
- Presentation tests for ammo-free HUD, hidden fist model, bat model, and deterministic swing phases.
- Real two-client coverage proving replicated attack sequence, health/crime effect, and unchanged ammunition.
- Phaser and Three browser QA showing fists/bat cycling and visible bat swing without layout regressions.


# Armor and Hit-Reaction Reference Study

Updated: 2026-07-10

This note defines the production behavior NOCK0 should preserve when adding body armor and synchronized victim reactions. The primary code reference is the GTA III re3 source at `daynz/GTAviceCity`, commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`. Current GTA Online inventory behavior is used only to shape acquisition and UI boundaries.

NOCK0 borrows system boundaries and behavioral nuance, not source code or Rockstar content.

## Reference Findings

### Damage, protection, armor, and reaction are separate decisions

`CPed::InflictDamage` first rejects ineligible damage through victim state and proof flags, then applies player/stat scaling, selects a weapon- and direction-specific death response, drains armor, drains health, and finally chooses nonlethal versus lethal lifecycle behavior. Armor is not a proof flag and is not extra health hidden inside weapon code.

Relevant source:

- [`PedFight.cpp` victim damage resolution](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedFight.cpp#L2057-L2491)
- [`Ped.h` health and armor state](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Ped.h#L436-L437)

The transferable order is:

1. reject dead, protected, proof, or otherwise ineligible victims;
2. calculate the accepted impact amount;
3. absorb eligible impact into armor before health;
4. publish the complete result, including armor-only contact;
5. trigger crime, perception, and presentation from the accepted contact;
6. enter death lifecycle only when resulting health reaches zero.

re3 bypasses armor for drowning but lets armor absorb melee, bullets, explosions, fire, falls, and vehicle impact after damage scaling. NOCK0 does not yet simulate drowning or proof flags, so every current damage family is armor-eligible. This stays explicit in a pure policy so future fire, drowning, or armor-piercing ammunition can opt out without branching in `DistrictRoom`.

### Armor-only contact is still a real hit

The weapon path calls `ReactToAttack`, chooses a directional defend animation, and registers assault before or around victim health mutation. re3 records armor-loss and health-loss times separately. An impact fully absorbed by armor therefore still needs:

- a replicated reaction edge;
- armor loss in the HUD;
- a damage fact with attacker identity;
- witness/crime handling;
- no false health loss or death.

`damage.applied.amount` in NOCK0 will remain the total accepted impact so existing perception severity still sees armor-only violence. New `armorDamage`, `healthDamage`, `remainingArmor`, and `remainingHealth` fields make the split auditable.

### Direction is victim-relative

`CPed::GetLocalDirection` quantizes the attacker/impact offset relative to victim heading into four stable sectors: front, left, back, and right. Both melee defend and gun-hit animations consume this direction.

Relevant source:

- [`Ped.cpp` local direction mapping](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Ped.cpp#L3498-L3511)
- [`PedFight.cpp` defend selection](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedFight.cpp#L863-L1021)

NOCK0 can reproduce this exactly from authoritative target pose and source point. Clients receive the resulting sector and normalized reaction progress; they do not infer a reaction from local projectile timing.

### Reaction strength and repeat timing matter

re3 distinguishes short directional gun reactions, fight defend moves, high-impact falls, and death animations. Player gun-hit animations have a repeat delay: roughly one second for ordinary firearms and 2.5 seconds for AK/M16 fire. Shotguns force a high-impact fall. Bat contact and health threshold crossings can also knock down victims. Repeated damage still applies while an equal-or-weaker reaction is suppressed.

The browser adaptation uses three bounded reaction families:

| Reaction | Authority effect | Initial duration |
| --- | --- | ---: |
| Flinch | brief attack/movement interruption | 220 ms |
| Stagger | stronger directional interruption | 420 ms |
| Knockdown | long recovery pose and control lock | 950 ms |

An active reaction is not restarted by equal-or-weaker damage. A stronger impact can upgrade it. This avoids permanent SMG stun while preserving visible heavy hits. Death supersedes every reaction.

### Armor is content and inventory, not appearance

re3 initializes armor by actor archetype: street cops have none, SWAT has 50, and FBI/army have 100 in [`CopPed.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L20-L61). GTA Online exposes owned Body Armor through Inventory and the weapon wheel; Rockstar explicitly notes that hiding the visible vest does not remove the active armor bar or absorption effect.

Official current references:

- [Rockstar GTA Online Freemode inventory guide](https://www.rockstargames.com/gta-online/guides/7772?section=8oo4)
- [Rockstar support: cosmetic armor visibility versus active armor](https://support.rockstargames.com/articles/5ObTkl0taC52zbyDu2qF1F/how-to-remove-body-armor-in-grand-theft-auto-online)
- [Rockstar title update 1.67: armor purchase and weapon-wheel equip behavior](https://support.rockstargames.com/articles/6Dzat0mIjSMSSvLAoBZE9D/gtav-title-update-1-67-notes-ps5-ps4-xbox-series-x-s-xbox-one-pc)

NOCK0 will keep armor mechanically separate from character cosmetics. The first playable acquisition path extends the existing Ammunition service into a paid combat resupply that fills ammunition and armor. Owned armor tiers, carried reserves, quick equip, drops, and mission-restock rules belong to the later private inventory/economy slice.

OpenGTA2 currently exposes no implemented armor or health behavior to reuse, so it remains an asset/map reference for this slice rather than a gameplay authority.

## NOCK0 Design

### Domain ownership

- `combat-survivability-policy.ts`: pure armor/health split, direction quantization, reaction strength, duration, and upgrade rules.
- `CombatReactionController`: replicated reaction sequence/kind/direction/progress, bounded runtime, player action interruption, NPC pause, expiry, and cleanup.
- `DamageController`: eligibility, authoritative armor/health mutation, typed damage/death facts, crime, rewards, panic, and lifecycle routing.
- Projectile, melee, explosion, and vehicle systems: provide source family, source point, and force; they do not select animations or mutate armor.
- Street service policy/controller: quote and apply combat resupply through the existing idempotent economy port.
- Phaser and Three renderers: consume the same pure reaction presentation policy.

`DistrictRoom` may construct these owners, connect narrow ports, and schedule their updates. It must not calculate armor absorption, direction, reaction strength, or animation timing.

### First-slice rules

- Maximum player armor is 100 and starts at zero.
- All current damage families consume armor before health.
- Armor-only hits still create damage, reaction, crime, and perception facts.
- Bullet and light melee hits flinch or stagger; shotgun, bat, blast, and vehicle impacts can knock down.
- Crossing into critical health can upgrade melee/bullet impact to knockdown.
- Equal-or-weaker repeated reactions do not restart the active lock; stronger reactions upgrade it.
- Accepted reactions interrupt an active melee/vehicle-entry action through owner callbacks, then use the existing generic action gate for movement, aiming, cycling, interaction, and firing.
- NPC AI pauses during replicated reaction time and resumes from its preserved private intent afterward.
- Death and respawn clear reaction state. Armor naturally reaches zero before lethal health damage and is not restored by public treatment.
- The Ammunition marker offers one atomic ammunition-plus-armor resupply debit. Durable inventory and armor tiers remain deferred.

## Required Evidence

- Pure tests for armor absorption/overflow, direction sectors, reaction classification, critical-health upgrade, and no-restart/upgrade behavior.
- Controller tests for replicated sequence/progress, action interruption, expiry, NPC pause contract, death/cleanup, and stronger-reaction upgrade.
- Damage tests proving armor-only facts/crime, health overflow, lethal routing, spawn protection, and event field accuracy.
- Projectile/melee/explosion/vehicle tests proving source family and source-point routing.
- Service tests proving armor contributes to the quote and resupply is one idempotent debit.
- Two-client integration proving armor absorption, remote replicated reaction, knockdown recovery, ordinary death/respawn, and continued play.
- Phaser and Three desktop/mobile QA showing the armor bar and matching directional flinch/knockdown presentation without canvas or layout regressions.

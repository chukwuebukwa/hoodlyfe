# Combat System Research and Modular Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

The GTA III/Vice City source does not implement combat in its world/session coordinator.

- `CWeaponInfo` is immutable weapon content: fire family, range, firing rate, reload time, clip size, damage, projectile speed, radius, lifespan, spread, fire offset, animations, model, and behavioral flags.
- `CWeapon` is holder runtime and fire control: weapon state, clip/total ammunition, timer, reload, melee, instant-hit, shotgun, projectile, area-effect, sniper, and drive-by paths.
- `CBulletInfo` is a bounded active-projectile owner with source, type, position, velocity, damage, lifetime, update, collision, and a fixed capacity of 100.
- Projectile, explosion, shot, and fire managers are separate lifetime/effect families rather than branches inside the player class.
- Bullet impact resolves the struck entity type, but victim classes own their response through `CPed::InflictDamage` and `CVehicle::InflictDamage`.
- Drive-by fire has its own origin/aiming behavior and still passes through weapon and victim damage rules.
- Presentation concerns such as weapon effects, particles, shells, audio, and animations are downstream of the fire/impact decision.

References:

- [`WeaponInfo.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/WeaponInfo.h)
- [`Weapon.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/Weapon.h)
- [`Weapon.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/Weapon.cpp)
- [`BulletInfo.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/BulletInfo.h)
- [`BulletInfo.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/BulletInfo.cpp)
- [`Explosion.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/Explosion.h)
- [`PedFight.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedFight.cpp)

## NOCK0 Adaptation

NOCK0 needs authoritative multiplayer and currently represents gunfire as short-lived replicated projectiles rather than copying every original instant-hit path. The transferable boundaries are:

1. `FireControlController`: validate holder state, seat, action, cooldown, ammunition, spread, pellet count, and muzzle origin; create authoritative bullets.
2. `ProjectileController`: own bullet movement, lifetime, swept collision, source exclusion, target-family routing, and deferred removal.
3. `DamageController`: apply player/NPC health changes, publish damage/death facts, report crimes, update NPC threat response, and issue rewards.
4. `PlayerLifecycleController`: own death, vehicle removal, wanted reset, input reset, respawn timing/location, health, ammunition refill, and respawn events.
5. `VehicleSimulationController`: remain the owner of vehicle-specific mechanical damage and destruction.

`DistrictRoom` maps messages to fire control, calls projectile updates in the fixed schedule, and wires narrow callbacks. It owns no weapon, projectile, damage, or respawn rules.

## Required Production Nuance

- Weapon definitions stay data-driven and include room for fire family, range, reload/clip, spread, projectile properties, animation timing, model, and flags.
- Fire control is server authoritative and rate-limited per player; clients cannot choose damage, ammunition, projectile count, or cooldown.
- Passenger origin depends on seat and vehicle heading; drivers cannot shoot with the current weapon set.
- Projectile collision is swept across the full tick segment to avoid tunneling.
- Source occupants cannot shoot their own occupied vehicle.
- Police bullets only damage currently wanted players.
- Projectile structural removal remains deferred until the lifecycle phase.
- Damage and kill rewards emit typed facts before a future durable economy consumer; current room cash remains nonredeemable street cash.
- Fire, explosions, melee, and true instant-hit weapons become separate implementations behind the same public contracts, not conditionals in the room.

## Acceptance Tests

- Pistol, SMG, and shotgun preserve cooldown, ammunition, pellet, spread, speed, lifetime, and damage behavior.
- Invalid holder states, drivers, empty weapons, and cooldown violations cannot fire.
- Passenger fire uses a seat-correct world origin and cannot damage the occupied car.
- Swept bullets hit players, vehicles, or NPCs once, then remove deterministically.
- Police fire cannot damage an unwanted player.
- Player and NPC damage publish typed damage/death events and route crime severity correctly.
- Player death removes vehicle occupancy and wanted response; respawn restores health, ammunition, input, and clean police state.
- Existing two-client passenger, combat, death, and respawn integration remains green.

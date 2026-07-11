# Molotov and Persistent Fire Research

## Production Reference

The implementation was shaped from the pinned Vice City source at commit `3233ffe1`:

- `ProjectileInfo.cpp` keeps Molotov flight in the bounded projectile family, applies gravity and a short failsafe lifetime, and resolves it differently from a bouncing grenade.
- `Explosion.cpp` gives a Molotov no ordinary blast power. Its impact starts ground fire and repeatedly affects nearby pedestrians and vehicles for a finite lifetime.
- `Fire.cpp` owns fire lifetime, cadence, source attribution, attachment/world position, propagation policy, and cleanup separately from explosion state.

This is a clean-room architecture translation, not copied source or constants.

## NOCK0 Ownership

- `weapon-catalog.ts` owns selection, ammunition, cooldown, and presentation metadata.
- `ThrownProjectileController` owns private velocity, gravity, world/ground impact, capacity, and final resolution request for grenade and Molotov projectiles.
- `FireZoneController` owns bounded world-fire creation, source attribution, damage cadence, actor filtering, capacity eviction, and expiry.
- Existing `DamageController` and `VehicleSimulationController` remain the only health/component mutation paths.
- `DistrictReplicationController` applies the existing transient street AOI policy to fire zones.
- Phaser and Three clients render the same replicated fire facts; audio and pedestrian stimulus adapters consume `fire.created` events.

`DistrictRoom` only composes these ports and schedules updates. It contains no fire radius, damage, capacity, or presentation rules.

## First Playable Boundary

- Molotovs shatter on the first world or descending ground impact and use a two-second failsafe.
- Ground fire lasts six seconds, damages at a 500 ms cadence, and is capped at three zones per owner and 24 globally.
- Players inside vehicles are excluded from direct fire damage because the occupied vehicle receives component damage instead.
- Fire creation is audible and causes a sustained pedestrian fire stimulus.
- Ammu-Nation prices and restores Molotov and grenade inventory through the existing atomic resupply path.

## Deliberate Follow-ups

- Actor-attached burning, fire spread, extinguishing, water/fire-engine interactions, and fireproof flags.
- Author-authored flame animation and light emission tuned with the day/night system.
- Molotov pickup/shop content and mission loadouts.
- Occlusion-aware fire contact and damage falloff if profiling and playtesting justify the extra work.


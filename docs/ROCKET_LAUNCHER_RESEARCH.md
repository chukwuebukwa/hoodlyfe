# Rocket Launcher Research

## Scope

This slice adds an original browser-game rocket launcher while using the pinned Vice City reverse-engineering source as a behavioral reference. No source code or proprietary art was copied.

Reference checkout: `/tmp/GTAviceCity-src` at `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

## Production Behaviors Studied

The reference implementation separates four responsibilities:

1. Weapon fire validates the launch origin before creating a projectile.
2. Projectile state owns forward motion, a bounded lifetime, collision, and smoke presentation.
3. Collision or expiry removes the projectile and creates a typed rocket explosion.
4. The explosion system owns radial damage, attribution, audiovisual effects, and secondary vehicle destruction.

Relevant clean-room reference points:

- `src/weapons/Weapon.cpp`: rocket launch and blocked-origin handling.
- `src/weapons/ProjectileInfo.cpp`: 1400 ms lifetime, moving missile state, smoke, collision/line-of-sight removal, and rocket explosion dispatch.
- `src/weapons/Explosion.cpp`: typed blast policy and entity damage.

## NOCK0 Design

- `FireControlController` consumes one round only after `RocketProjectileController.launch` accepts the entity.
- The launcher is unavailable to drivers and passengers. This avoids clipping and preserves the existing passenger sidearm contract.
- Rockets are authoritative replicated entities with a 1400 ms lifetime, 430 px/s speed, two-per-owner and 32-global limits.
- Swept segment-circle tests select the earliest player, NPC, or vehicle impact. Seven-pixel world samples prevent thin walls from being skipped during long simulation frames.
- A bounded detonation tombstone set prevents stale updates from producing duplicate explosions.
- `ExplosionController` remains the only radial-damage authority. Rocket blasts use a dedicated 155 px policy, retain an active player source, damage the shooter at close range, and can trigger existing vehicle chain reactions.
- Phaser and Three render the same authored launcher model; in-flight rockets use an exhaust treatment, with Phaser also emitting a short smoke trail.
- Ammu-Nation restocks four rockets and prices each missing rocket at $75.

## Deliberate Boundaries

- There is no lock-on targeting. NOCK0 is a mouse/touch aimed top-down game.
- Rockets do not bounce or pass through actors.
- Explosion occlusion is not yet modeled. A future blast-query layer should attenuate damage across authored walls without moving that concern into projectile motion.
- Rocket pickups are deferred until the general weapon pickup catalog replaces the grenade-only pickup controller.

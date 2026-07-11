# Explosives and Weapon Pickup Research

Date: 2026-07-10

This study defines the first explosive weapon slice without turning bullet movement, explosions, vehicle fire, pickups, and presentation into one combat controller.

## Production References

Pinned local source: `/tmp/nock0-GTAviceCity` at `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

### Weapon and Projectile Ownership

- `src/weapons/Weapon.cpp` selects instant-hit, area-effect, or projectile firing by weapon type. Grenade/Molotov throw strength is separate from the projectile runtime.
- `src/weapons/ProjectileInfo.cpp` owns a bounded projectile pool, source reference, weapon type, object, velocity, gravity, elasticity, special collision response, previous position, and fuse. Grenades use gravity, 0.5 elasticity, and a 2,000 ms fuse; removal converts the projectile into a typed explosion.
- Rockets use no gravity and detonate on collision, obstructed travel, or timeout. Molotovs use collision/timeout but create fire rather than blast power. These must remain later content policies over the same projectile/explosion boundaries.

### Explosion Ownership and Damage

- `src/weapons/Explosion.cpp` owns a bounded typed explosion pool, creator/victim references, radius, propagation, power, active lifetime, and presentation timing. It invokes world damage once and continues presentation independently.
- Grenade, rocket, car, mine, barrel, and other explosion types have separate radius/power/lifetime policy. Molotov explicitly has zero blast power and starts a ground fire, proving that explosion visuals and damage/fire effects are not interchangeable.
- `src/core/World.cpp::TriggerExplosion` bounds broad-phase sector queries, then applies exact radial checks to vehicles, pedestrians, and objects. It excludes pedestrians inside vehicles, respects explosion-proof state, applies impulse, and uses:
  - `min((radius - distance) * 2 / radius, 1)` damage falloff;
  - full damage through the inner half of the radius;
  - linear falloff from half radius to zero at the edge;
  - distinct pedestrian, vehicle, and object damage scales.
- The production blast path does not perform wall line-of-sight occlusion. NOCK0 will preserve that rule for the first slice and revisit cover only as an explicit design change.
- Vehicle destruction retains culprit attribution and can shorten other bomb timers. NOCK0 will use typed `vehicle.destroyed` facts to create a later-tick car blast, avoiding direct vehicle-to-explosion imports and allowing deterministic chain reactions.

### Fire Ownership

- `src/core/Fire.cpp` owns a separate bounded fire pool, attached entity or world position, source, strength, propagation flag, extinguish deadline, damage cadence, reporting, and cleanup.
- Molotov explosions start ground fire and periodically set nearby pedestrians/vehicles on fire; vehicle and pedestrian fire apply damage over time and can propagate. This lifecycle is too different from a one-shot grenade blast to share one controller.

### Pickup Ownership

- `src/control/Pickups.cpp` owns a bounded pickup pool, generation-safe IDs, pickup type, quantity, timer, model, position, remove/recreate behavior, and collected history.
- Street weapons grant configured ammunition, optionally select the weapon, disappear, and use a timed recreation policy. One-shot, shop, money, mine, and slow street pickups have different lifecycle rules.
- OpenGTA2 currently exposes GTA2 script/data parsing such as `GIVE_WEAPON` but does not provide a production gameplay implementation for projectile, explosion, fire, or pickup runtime. It remains useful for compatibility content identifiers only, not behavior.

## NOCK0 First Slice

The first playable slice is one grenade weapon and one shared respawning street pickup:

- grenade is a fourth cycleable weapon with finite authoritative ammunition;
- successful fire creates a dedicated thrown projectile, never a bullet with a larger damage number;
- the projectile has private planar/vertical velocity, gravity, ground/world bounce, damping, a 2,000 ms fuse, and bounded per-player/global concurrency;
- replicated projectile state contains only presentation position, height, owner, kind, and fuse deadline;
- detonation creates a transient replicated explosion and applies damage exactly once;
- grenade blast uses a 130 px radius, full damage inside 65 px, then production-shaped linear falloff;
- pedestrians take up to 120 damage and vehicles up to 650 before their existing component/ignition/destruction policy;
- on-foot occupants are blast candidates, but players inside vehicles are excluded and instead depend on vehicle destruction/ejection damage;
- self-damage is enabled; spawn protection still gates damage and successful throw cancels protection;
- player attribution is retained, but a disconnected source cannot recreate wanted state after cleanup;
- a destroyed vehicle emits a later-tick car blast through the event adapter, enabling bounded chain reactions without recursive cross-domain calls;
- one shared pickup grants three grenades up to a six-grenade capacity and respawns after 20 seconds;
- all mutation stays in the fixed simulation schedule; the pickup never writes HUD state and the browser never decides collection or blast victims.

Persistent fire, Molotovs, rockets, mines, explosive props, throw charging, knockback, cover occlusion, and mission-spawned pickup ownership follow only after this boundary passes.

## Module Boundaries

- Shared weapon/explosive/pickup catalogs: immutable IDs, capacities, fuse, physics, blast, quantity, and respawn policy.
- `WeaponPickupController`: bounded placement, shared availability, authoritative proximity collection, quantity cap, respawn, notices, and pickup events.
- `ThrownProjectileController`: bounded private velocity/fuse runtime, collision bounce, replicated pose, detonation request, and cleanup.
- `ExplosionController`: one-shot radial resolution, entity-family damage ports, transient replicated state, source attribution, car-destruction event adaptation, and cleanup.
- Existing `FireControlController`: holder/cooldown/ammunition/seat gates and dispatch to bullet versus thrown projectile creation.
- Existing `DamageController` and `VehicleSimulationController`: health, crime, rewards, component damage, ignition, destruction, and occupant consequences.
- Client renderers: pickup marker/model, grenade arc/shadow, blast flash/rings/particles, HUD icon, and held model only.

`DistrictRoom` may wire these owners and schedule their updates. It must not calculate fuse, bounce, falloff, victims, pickup quantity, or chain reactions.

## QA Gate

Required coverage includes bounded pools, cooldown/ammo gates, passenger restriction, throw/fuse/bounce, one-shot detonation, inner/outer/edge falloff, self damage, occupant exclusion, spawn protection, player/NPC/vehicle attribution, disconnected-source behavior, vehicle chain delay, no recursive duplicate blast, pickup contention/cap/respawn, schema/render projection, real two-client regression, production build, visible browser throw/explosion/pickup behavior, and clean logs.

## Implementation Result

- Delivered the fourth `grenade` weapon with two starter grenades, a six-grenade cap, Q/E/button/wheel cycling, a held model, HUD icon/ammunition, and no passenger use in this first slice.
- Added separate replicated maps for thrown projectiles, transient explosions, and shared weapon pickups. Private projectile velocity never enters public state.
- Added bounded global/per-owner throw capacity, 2,000 ms fuse, gravity, independent-axis world bounce, ground elasticity/damping, and exact-once detonation cleanup.
- Added 130 px grenade and 170 px vehicle blast policies with full inner-half damage and linear outer-half falloff. Vehicle blasts exclude occupants already handled by destruction/ejection.
- Added active-session attribution checks, self-damage without self crime/reward, explosion-specific vehicle damage facts, correct component-side classification, and later-step vehicle chain reactions.
- Added one collision-safe shared grenade cache near spawn, spatial candidate query, nearest-then-ID contention, three-grenade grant, six cap, 20-second respawn, notice/event, world model, and minimap marker.
- Kept normal ammunition service policy unchanged so grenades retain street-pickup scarcity. Trauma Care's complete refill restores grenades to six.
- Added dedicated browser renderers for arc/shadow/fuse pulse, edge-triggered blast core/rings/particles/shake, and pickup lifecycle; no gameplay decision moved client-side.

Focused explosive/presentation tests passed 25/25; the final full suite passed 147/147 and the production TypeScript/Vite build passed. Live browser QA verified pickup presentation, grenade HUD/model, authoritative ammunition consumption, replicated transient creation/cleanup, and a fresh post-reload warning/error window with zero entries.

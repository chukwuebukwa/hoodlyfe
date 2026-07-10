# Replicated Entity Rendering Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Ownership Found

- `CPools` owns bounded entity allocation, stable handles, lookup, deletion, and shutdown assertions for peds, vehicles, objects, buildings, and temporary entities.
- `CRenderer` builds visible and invisible entity lists, runs pre-render, separates roads/opaque/transparent passes, handles render order, and removes transient lighting afterward.
- `CPed::PreRender` and `CPed::Render` own ped-specific animation/model presentation hooks such as weapon attachment, shadows, and lighting without owning the global visible set.
- `CBulletInfo` is a bounded active-bullet manager with explicit add/update/lifetime slots rather than unbounded scene objects.
- Entity removal and render-object deletion are explicit lifecycle operations. A world record disappearing does not leave its model/effects/listeners behind.

References:

- [`Pools.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Pools.h)
- [`Pools.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Pools.cpp)
- [`Renderer.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/renderer/Renderer.h)
- [`Renderer.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/renderer/Renderer.cpp)
- [`Ped.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Ped.cpp)
- [`BulletInfo.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/BulletInfo.h)
- [`BulletInfo.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/BulletInfo.cpp)

The reference is used to study ownership and lifecycle only. NOCK0 remains an original Phaser implementation.

## NOCK0 First Extraction

- `PedestrianRenderer` owns the NPC render map, sprite creation, replicated target updates, visibility, interpolation, rotation, walk animation, depth, and teardown.
- `ProjectileRenderer` owns the bullet render map, visual style, target updates, interpolation, muzzle flash lifetime, and teardown.
- A projectile-created callback reports shooter ID to the player renderer/scene so passenger peek recoil remains a player-animation concern.
- `DistrictScene` delegates collection synchronization and frame interpolation; it no longer iterates or destroys NPC/projectile render objects directly.
- Pure interpolation policy computes snap-versus-blend positions and shortest-angle rotation without Phaser or DOM dependencies.

## Required Production Nuance

- Renderer maps are presentation caches keyed by authoritative entity ID; they never become gameplay state.
- Create/update/remove is idempotent and collection synchronization destroys every stale object exactly once.
- Large corrections snap; ordinary network corrections blend. Local prediction, remote interpolation, vehicles, peds, and fast projectiles use separate tuning.
- Angles rotate through the shortest path and tolerate wraparound.
- Depth ordering is recomputed from world position; passenger/weapon/vehicle composition keeps explicit depth contracts.
- Offscreen culling and area-of-interest replication reduce active objects before object pooling is added.
- Frequently created bullets, flashes, labels, smoke, fire, and impact effects should move to bounded pools once profiling proves allocation pressure.
- Asset/model selection is content data and validated before render creation.
- Scene shutdown destroys all cached objects and transient tweens/effects.
- Rendering failures and missing assets degrade presentation but cannot mutate authoritative state.
- Interpolation uses server tick/receive timing and a buffered render clock in the next networking phase rather than a fixed per-frame percentage alone.

## Acceptance Tests

- Interpolation preserves normal blends, snaps beyond threshold, and rotates by the shortest wrapped angle.
- NPC collection synchronization creates, updates, hides dead actors, and destroys removed actors.
- Projectile collection synchronization creates style-correct bullets, reports creation once, updates targets, and destroys removed bullets.
- Existing pedestrian walk animation, dynamic depth, police bullet color, weapon-specific projectile size/color, muzzle flash, and passenger recoil remain visible.
- Live debug and minimap continue reading authoritative state independently of render caches.

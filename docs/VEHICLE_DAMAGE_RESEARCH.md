# Vehicle Damage Research and NOCK0 Adaptation

Date: 2026-07-10

Reference snapshot: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Legal and Engineering Boundary

The repository does not provide a usable license for the game source. NOCK0 uses it only as a behavioral reference. We do not copy implementation code, symbols, assets, data tables, or file structure. The NOCK0 implementation is original TypeScript designed for deterministic server authority and a 2D circle/contact model.

## Production Behaviors Found

### Durability Is Not a 100-Point Bar

`CVehicle` initializes vehicle health to 1000. Weapon damage is processed by type, respects melee/bullet/explosion/fire/collision proof flags, and generally subtracts the configured weapon damage directly. This explains why a 100-point prototype makes cars fail far too quickly.

References:

- [`Vehicle.cpp` constructor and damage path](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Vehicle.cpp)
- [`Weapon.cpp` vehicle hit dispatch](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/weapons/Weapon.cpp)

### Collision Damage Uses Impulse, Thresholds, and Handling Data

Automobile collision damage is not a fixed hit. The code ignores small impulses, multiplies meaningful impacts by per-model handling damage, applies different resistance factors, and damages the body component that was struck. Collision damage that would cross zero is clamped into a critical state so the fire path can resolve instead of every hard crash exploding immediately.

Reference: [`Automobile.cpp` vehicle damage](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Automobile.cpp).

### Global Health and Local Damage Coexist

The damage manager tracks engine, four wheels, six doors, lights, panels, bumpers, bonnet, boot, and windscreen. Components progress through multiple states rather than using one global percentage. Engine status has staged thresholds for first steam, heavier steam, smoke, and fire.

References:

- [`DamageManager.h` component and status model](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/DamageManager.h)
- [`DamageManager.cpp` component progression](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/DamageManager.cpp)

### Critical Damage Has Telegraphing and Escape Time

At low health the engine enters an on-fire state. Automobile processing renders flames/smoke and runs a roughly five-second timer before explosion. Extinguishing or repairing can raise health, lower the engine state, and reset the timer. This creates a readable danger window rather than an arbitrary instant failure.

References:

- [`Automobile.cpp` fire processing](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Automobile.cpp)
- [`Vehicle.cpp` fire reset](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/vehicles/Vehicle.cpp)

### Damage Changes Behavior, Not Only Presentation

Ambient drivers can flee after weapon damage or severe health loss. Burst wheels change tire forces. Engine state affects audio and effects. Police-car damage can create wanted consequences. A complete damage system therefore feeds AI, handling, crime, audio, effects, mission scoring, and repair rather than being a decorative bar.

## NOCK0 Adaptation

Implemented now:

- 1000-point base health, replicated `maxHealth`, and per-archetype collision resistance;
- an impulse threshold with mass and collision-damage scaling;
- four deterministic 2D impact zones: front, rear, left, and right;
- accumulated zone damage plus a separate 0-250 engine-damage state;
- engine stages at 100, 150, 200, and on-fire at 225;
- performance loss based on engine state rather than linear body-health loss;
- collision/wall lethality clamped to one health and converted to a fire state;
- a five-second server-owned fire fuse before explosion;
- direct weapon lethality, typed ignition/destruction events, occupant ejection, and restoration;
- debug labels exposing health, engine state, four zones, fire, and wreck state.

Intentional multiplayer changes:

- no special durability advantage for one local player's car;
- no frame-order randomness in component progression;
- no client-owned timers or explosion decisions;
- no 3D door/wheel mesh detachment until original sprites can represent those states;
- compact replicated scalar fields instead of the reference's packed native structures.

## Calibration Targets

The first balance pass targets these rough outcomes for a standard 1000-health sedan:

| Cause | Approximate result |
| --- | --- |
| Pistol | 25 vehicle damage; about 40 direct hits |
| SMG | 12 vehicle damage; sustained fire is effective but not instant |
| Shotgun | Six 18-damage pellets; close hits reward pellet coverage |
| Full-speed wall crash | About 100 damage, strongly front-loaded |
| 240-unit closing collision | About 120 damage before mass/resistance changes |
| Health at or below 250 | Fire warning and five-second explosion fuse |

These are starting targets, not constants promised to players. Scenario telemetry and playtests should tune them by session outcome: cars must survive ordinary traffic contact, clearly degrade after repeated hard crashes, and give occupants time to react to fire.

## Next Vehicle Depth

1. Add wheel/tyre condition and asymmetric steering pull.
2. Add explosion radius, chain reactions, fire damage, and crime attribution.
3. Add NPC driver reactions to gunfire, smoke, and severe damage.
4. Add repair/respray service policy and condition-adjusted mission payouts.
5. Add proof flags for mission vehicles and armored archetypes.
6. Add door/bonnet/wreck sprite variants when original vehicle art supports them.

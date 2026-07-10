# NOCK0 Feature Roadmap and Status

Updated: 2026-07-10

This is the canonical status list for the requested top-down multiplayer GTA-like experience. Research rationale remains in `GAMEPLAY_RESEARCH.md`; engineering ownership remains in `PROJECT_STRUCTURE.md`; the chain boundary remains in `ONCHAIN_INTEGRATION.md`.

## Status Vocabulary

- **Playable**: visible in the browser and covered by authoritative tests.
- **Foundation**: a real reusable boundary exists, but content or production nuance is incomplete.
- **Next**: one of the next implementation slices.
- **Later**: intentionally dependency-gated, not forgotten.
- **Parallel**: can advance without blocking the current 2D street loop.

## Playable Now

### Multiplayer and Controls

- **Playable** browser client and authoritative Colyseus district server.
- **Playable** multiple named players with nameplates on foot and over occupied vehicles.
- **Playable** keyboard, pointer, weapon buttons, Q/E cycling, mouse wheel, and touch controls.
- **Playable** remote interpolation, local presentation prediction, responsive camera, HUD, and mobile controls.
- **Playable** death and clean respawn with health, ammunition, action, vehicle seat, input, and wanted state reset.

### Combat and Weapons

- **Playable** pistol, SMG, and shotgun with distinct cooldown, ammunition, pellet/spread, projectile, HUD icon, and held-weapon presentation.
- **Playable** server-authoritative aim, firing gates, projectile movement, collision, player/NPC/vehicle damage, kill rewards, and respawn.
- **Playable** passenger drive-by shooting with seat-specific muzzle origins and a visible passenger lean/peek presentation.
- **Foundation** weapon-family separation exists; melee, thrown weapons, explosions, fire, pickups, reloads, recoil/accuracy, and weapon shops remain content work.

### Vehicles and Traffic

- **Playable** four-seat vehicles, driver/passenger entry, exit, passenger promotion, multiplayer occupancy, and occupant nameplates.
- **Playable** hijacking of ambient traffic, ejected driver creation, authoritative entry timing, and visible action presentation.
- **Playable** moving ambient traffic with deterministic road following/turn selection, ahead-corridor vehicle following, pedestrian stopping, asymmetric braking/acceleration, and blocked-route recovery.
- **Playable** car-to-car separation, momentum transfer, pedestrian impacts, component damage, staged body damage, engine degradation, ignition, delayed explosion, occupant ejection, and restoration.
- **Playable** Sedan, Taxi, and Police Cruiser consume one shared catalog but have distinct health, mass, impact resistance, acceleration, braking, speed, steering, traffic policy, seating, and presentation metadata.
- **Foundation** the original sprite selection remains small; additional vehicle classes, lane behavior, traffic signals, emergency response driving, parking, and repair shops remain incomplete.

### Crime, Police, and Pedestrians

- **Playable** crimes become bounded incidents; witnesses report after delay; unwitnessed incidents expire.
- **Playable** wanted heat, response caps, police dispatch assignments, pursuit, last-known-position search, line-of-sight fire, heat decay, and respawn reset.
- **Playable** ambient civilian/police population, ejected drivers, event stimuli, bravery, investigation, startle, sustained flee, recovery, death, and respawn.
- **Playable** bounded deterministic pedestrian paths around large collision obstacles with per-tick work limits and private route memory.
- **Foundation** detailed arrests, containment, roadblocks, call-police behavior, gangs, cover, crowd propagation, sidewalks/crossings, and population level of detail remain incomplete.

### World, Navigation, Missions, and Diagnostics

- **Playable** GTA2 compatibility map, corrected collision layers, spawn, roads, labels, overhead props, and minimap.
- **Playable** GTA Online-inspired Freemode Boost and Deliver job with opt-in nearby crew, leader launch, shared objective, target reservation, wanted escape, delivery, failure states, and idempotent participant payouts.
- **Playable** minimap markers for players, police, contact, target, delivery, and local/remote vehicle positions.
- **Playable** opt-in F3/DBG diagnostics for collision, spatial cells, entities, incidents, pursuits, stimuli, AI objectives, bravery, and pedestrian routes.
- **Foundation** the mission instance/entity-scope boundary can host more objectives; only one complete mission is currently available.

## Next Implementation Slices

These are ordered by how much of the city loop they improve and by their dependencies.

### 1. Vehicle and Traffic Depth

**In progress**

- **Delivered foundation**: stable shared content catalog for current Sedan, Taxi, and Police Cruiser; separated mass, footprint, health, acceleration, braking, grip, steering, reverse speed, seats, traffic tuning, and presentation ID.
- **Delivered foundation**: traffic agents brake for vehicles/pedestrians, preserve model-specific following distance, distinguish valid queues from world blockage, recover deterministically, and expose limiting reasons through F3.
- Add original-art compact, sports, van, truck, bus, motorcycle, ambulance, and special profiles only when each has a validated frame, footprint, seat layout, and road compatibility.
- Add explicit lane/intersection ownership, stop lines, signals, parking points, and local disabled-car avoidance.
- Add police vehicles and a first road pursuit without giving traffic AI direct access to wanted state.
- Expand the private OpenGTA2 vehicle manifest for development while keeping gameplay IDs independent of GTA2 model numbers.

Exit gate: visibly different vehicle classes share the same authoritative physics/damage primitives, and traffic can follow/brake/recover without uncontrolled collision chains.

### 2. Street Services and Closed Economy Loop

**Foundation in progress**

- **Delivered foundation**: all current kill and mission rewards pass through one bounded idempotent street-economy port with integer validation, balance caps, typed audit events, and fail-closed capacity.
- Ammunition shop, repair garage, hospital fee, and clothing preview as explicit cash sinks.
- Carried street cash remains non-redeemable and session-local until durable identity exists.
- Price and reward policies live in an economy domain; combat, missions, and vehicles emit facts rather than changing balances directly.
- Add pickups and risky cash loss/recovery only after exploit and spawn-camping scenarios are tested.

Exit gate: a player can earn from a mission, damage a car, escape police, repair/resupply, and see every debit/reward applied once.

### 3. Reusable Freemode Mission Objectives

**Next after services**

- Extract definitions and reusable objectives: reach zone, acquire item, steal vehicle, escape wanted, deliver vehicle, eliminate target, hold area, and race checkpoints.
- Add courier/getaway, street race, and holdout jobs before a menu-heavy mission lobby.
- Preserve GTA Online Freemode rules: optional nearby joining, explicit roster lock, role-friendly shared work, individual death tolerance, leader transfer, bounded payout, and cleanup ownership.
- Add rotating district events such as GTA2-style Tag and Deathmatch with scores isolated from the street economy.

Exit gate: at least three mission definitions compose shared objective modules without mission code mutating combat, police, or vehicle internals.

### 4. Character Creator and Clothing

**Next after mission framework; art can proceed in parallel**

- Free development creator for skin tone, body/base, hair/headwear, top/jacket, bottoms, shoes, primary/accent colors, and outfit name.
- Appearance replicates as stable content IDs and palette values, never asset filenames.
- Original modular sprites must support walk, run, aim, fire, enter, hijack, passenger lean, hit, and death readability.
- Cosmetics never change hitbox, health, speed, aim, weapon damage, vehicle performance, detection, or payout.
- Saved outfits wait for account persistence; all current options stay unlocked during development.

Exit gate: two clients see the same customized actor in every current locomotion, combat, and vehicle state.

### 5. Durable Identity and Economy

**Next after the transient loop is balanced**

- Account ID and character ID independent of Colyseus session ID.
- Reconnection and duplicate-login policy.
- PostgreSQL append-only ledger with idempotency keys, carried/banked cash, inventory, wardrobe, and owned-vehicle records.
- Transactional reward/purchase application and an outbox; no database calls from the fixed simulation tick.
- Anti-farming limits, command rate limits, aim-rotation caps, reward auditing, and per-client private-state filtering.

Exit gate: reconnect, restart, duplicate messages, and settlement retries cannot duplicate or lose economic state.

## Progression and Social Systems

These begin after durable identity exists, but their gameplay-facing contracts should remain event-driven now.

- **Later** Stick RPG-style strength, intelligence, charm, driving, and reputation used as content requirements rather than raw pay-to-win multipliers.
- **Later** short interactive legal jobs, training, promotion tracks, bank, hospital, and time-of-day schedules.
- **Later** crews/clans with ranks, permissions, crew chat, crew minimap color, shared mission roles/payouts, and auditable treasury.
- **Later** gang reputation, territory opportunities, faction response, and contact unlocks.
- **Later** wardrobe slots, saved outfits, garages, temporary personal-vehicle claims, insurance/impound, and repair history.
- **Later** markets for original cosmetics, vehicles, and property records after ownership and anti-fraud rules are stable.

## Ownership and World Expansion

- **Later** owned cars stored as durable garage records; spawned room vehicles remain disposable simulation entities.
- **Later** apartments, garages, clubhouses, businesses, wardrobes, and friend/crew access through interior/district transfer contracts.
- **Later** property-launched setup chains, role-based group heists, businesses, and risky sale/delivery loops.
- **Later** original city geometry, districts, interiors, shops, homes, social venues, pedestrian destinations, road lanes, and traffic signals.
- **Later** multiple district rooms with account-backed transfer and area-of-interest replication.

Property is not blocked by 2D presentation, but it is blocked by original map/interior content, durable identity, ownership records, and district transfer lifecycle.

## Parallel OpenGTA2 3D Track

- **Parallel** renderer-neutral block geometry extraction in OpenGTA2.
- **Parallel** standalone Three.js chunk viewer behind a feature flag.
- **Parallel** actor, vehicle, weapon, projectile, label, input, HUD, minimap, and camera parity.
- **Later** authoritative elevation/surface IDs, multi-level collision, navigation, and line of sight only after renderer parity.

The working Phaser browser game remains the default until the Three renderer is feature-complete. GTA2-derived maps and sprites are private compatibility fixtures; public distribution and monetization require original art, layout, geometry, vehicles, and branding.

## Onchain Settlement Gate

Robinhood Chain remains an asynchronous settlement layer behind persistence, never a gameplay system.

Required order:

1. Original redistributable assets and city content.
2. Durable account/character identity, reconnection, database ledger, and idempotency.
3. Anti-abuse, private-state filtering, auditability, and reward-flow controls.
4. Legal/regulatory review for any real-value mechanic.
5. Async outbox settlement and reconciliation outside the district tick.

Street cash is permanently non-redeemable. Potential later mechanics are a non-custodial exchange interior, fixed pre-funded heist prizes, and cosmetic-first vehicle/property ownership records. None belongs in current district simulation code.

## Dependency Order

```text
authoritative street loop (playable)
  -> vehicle/traffic depth
  -> services + closed cash sinks
  -> reusable mission objectives
  -> character creator + original modular art
  -> durable identity + ledger + anti-abuse
  -> crews, stats, jobs, garages, wardrobes
  -> properties, businesses, markets, multiple districts
  -> optional asynchronous onchain settlement
```

The original-map pipeline and OpenGTA2 3D renderer can advance alongside the first four steps. They cannot weaken server authority or bind durable content IDs to Rockstar asset identifiers.

## Development and QA Rule

Each slice must start with a production reference study, define one domain owner and typed boundaries, expose enough opt-in diagnostics to prove behavior, add deterministic unit/scenario coverage, preserve the real two-client flow, pass the production build, and end with a timestamped devlog checkpoint and focused commit.

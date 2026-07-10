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
- **Playable** death and nearest-hospital respawn with public/trauma care choice, ammunition policy, action/vehicle/input/wanted cleanup, and bounded attack-cancelable spawn protection.

### Combat and Weapons

- **Playable** pistol, SMG, shotgun, and grenade with distinct cooldown, ammunition, fire mode, projectile, HUD icon, and held-weapon presentation.
- **Playable** server-authoritative aim, firing gates, projectile movement, collision, player/NPC/vehicle damage, kill rewards, and respawn.
- **Playable** passenger drive-by shooting with seat-specific muzzle origins and a visible passenger lean/peek presentation.
- **Playable** bounded thrown-grenade arc/fuse/bounce, production-shaped radial falloff, self damage, player/NPC/vehicle attribution, transient blast presentation, and car chain reactions.
- **Foundation** weapon-family separation exists; melee, rockets, Molotov/fire, mines, throw charging, reloads, recoil/accuracy, and weapon shops remain content work.

### Vehicles and Traffic

- **Playable** four-seat vehicles, driver/passenger entry, exit, passenger promotion, multiplayer occupancy, and occupant nameplates.
- **Playable** hijacking of ambient traffic, ejected driver creation, authoritative entry timing, and visible action presentation.
- **Playable** moving ambient traffic with deterministic road following/turn selection, ahead-corridor vehicle following, pedestrian stopping, asymmetric braking/acceleration, and blocked-route recovery.
- **Playable** two authored signalized intersections with replicated phases, stop-line braking, cross-axis occupancy holds, emergency bypass, wreck awareness, and F3 queue diagnostics.
- **Playable** deterministic stopped-car recovery with legitimate-stop suppression, bounded reverse, collision/road clearance probes, left/right passing, route merge, and retry cooldown.
- **Playable** car-to-car separation, momentum transfer, pedestrian impacts, component damage, staged body damage, engine degradation, ignition, delayed explosion, occupant ejection, and restoration.
- **Playable** Sedan, Taxi, and Police Cruiser consume one shared catalog but have distinct health, mass, impact resistance, acceleration, braking, speed, steering, traffic policy, seating, and presentation metadata.
- **Foundation** the original sprite selection remains small; additional vehicle classes, authored lane centerlines/turn connectors, siren yielding, dynamic traffic population, and parking remain incomplete. A functional repair garage is playable.

### Crime, Police, and Pedestrians

- **Playable** crimes become bounded incidents; witnesses report after delay; unwitnessed incidents expire.
- **Playable** wanted heat, response caps, police dispatch assignments, pursuit, last-known-position search, line-of-sight fire, heat decay, and respawn reset.
- **Playable** first police cruiser response with report-based search, bounded road routing, visible-target pursuit/interception, high-heat vehicle ramming, pursuit-only siren, hijack handoff, and F3 route/strategy diagnostics.
- **Playable** ambient civilian/police population, ejected drivers, event stimuli, bravery, investigation, startle, sustained flee, recovery, death, and respawn.
- **Playable** bounded deterministic pedestrian paths around large collision obstacles with per-tick work limits and private route memory.
- **Foundation** detailed arrests, containment, roadblocks, call-police behavior, gangs, cover, crowd propagation, sidewalks/crossings, and population level of detail remain incomplete.

### World, Navigation, Missions, and Diagnostics

- **Playable** GTA2 compatibility map, corrected collision layers, spawn, roads, labels, overhead props, and minimap.
- **Playable** GTA Online-inspired Freemode Boost and Deliver job with opt-in nearby crew, leader launch, shared objective, target reservation, wanted escape, delivery, failure states, and idempotent participant payouts.
- **Playable** Getaway Run composes the same crew/runtime boundaries with three ordered authoritative road checkpoints, wanted escape, delivery, condition payout, and cleanup.
- **Playable** Crew Checkpoint Rush adds five ordered road checkpoints carried by any living crew driver, no reserved target, fixed payout, and shared route progress.
- **Playable** Crew Holdout adds three escalating owned hostile waves, line-of-sight combat pursuit, contested hold progress, death tolerance, contribution-gated payout, and explicit actor cleanup.
- **Playable** compact job selector, shared immutable mission catalog, template-declared target/reward/encounter policy, and reusable acquire-vehicle, target-checkpoint, crew-checkpoint, hold-area, clear-wanted, and low-speed-delivery objective evaluators.
- **Playable** minimap markers for players, police, contact, target, delivery, and local/remote vehicle positions.
- **Playable** opt-in F3/DBG diagnostics for collision, spatial cells, entities, incidents, pursuits, stimuli, AI objectives, bravery, and pedestrian routes.
- **Foundation** four complete jobs now share objective/encounter modules; item, explicit eliminate-target, escort, placement-scored race, and event-mode objectives remain incomplete.
- **Playable foundation** feature-flagged Three.js district client with real OpenGTA2 block geometry, depth-tested entities, full gameplay/HUD/input parity, and Phaser fallback.
- **Playable foundation** one seamless same-building single-floor Threads showroom: walk through the east-wall doorway, switch replicated space/collision automatically, see the roof-open interior in the building footprint, and walk back out without a load screen.

### Street Economy and Services

- **Playable** bounded server-authoritative street cash with idempotent credits/debits, balance limits, typed audit events, mission payouts, and kill rewards.
- **Playable** replicated ammunition counter with missing-reserve pricing, cash validation, complete authoritative restock, world marker, minimap point, contextual action, and notices.
- **Playable** replicated repair garage with layered damage pricing, driver/speed/fire/wanted validation, complete vehicle/component/fire restoration, world marker, minimap point, contextual action, and notices.
- **Playable** two collision-safe hospitals with nearest-facility respawn, free 4.2-second Public Ward, $250 2.2-second Trauma Care, authoritative living treatment, wanted/vehicle gates, world/minimap markers, and idempotent billing.
- **Playable** discoverable clothing store that opens the existing creator in Wardrobe mode, with no duplicate renderer or customization path.
- **Playable** service-first interaction priority and same-tick duplicate suppression without moving service rules into `DistrictRoom`.
- **Playable** one shared grenade pickup grants three up to a six-grenade cap, resolves contention authoritatively, projects world/minimap presentation, and respawns after 20 seconds.
- **Foundation** street cash remains session-local and non-redeemable; money/item pickups, risky cash loss, durable ledger, durable inventory, purchases, and pricing remain incomplete.

### Appearance and Customization

- **Playable** free character creator with body presentation, skin tone, hair, headwear, top, bottoms, shoes, five color channels, ten swatches, outfit name, randomize, cancel, and apply.
- **Playable** server-validated nested appearance state replicates to local/remote on-foot and passenger presentation with local reload persistence for development.
- **Playable** one palette renderer powers preview and cached nine-frame world animation; inactive generated textures are bounded and pruned.
- **Playable** creator modal blocks gameplay input and has verified desktop/390x844 layouts.
- **Playable** private per-player session wardrobe grants every current item during development, validates owned styles before equip, and sends inventory only to its owning client.
- **Playable** appearance apply now waits for an authoritative result before local persistence; invalid, rate-limited, or unowned updates cannot partially mutate or falsely save.
- **Foundation** current procedural compatibility art will be replaced by original authored modular layer sheets; saved outfits, purchases, unlocks, pricing, and durable ownership remain incomplete.

## Next Implementation Slices

These are ordered by how much of the city loop they improve and by their dependencies.

### 1. Vehicle and Traffic Depth

**Playable foundation; lane authoring explicitly deferred**

- **Delivered foundation**: stable shared content catalog for current Sedan, Taxi, and Police Cruiser; separated mass, footprint, health, acceleration, braking, grip, steering, reverse speed, seats, traffic tuning, and presentation ID.
- **Delivered foundation**: traffic agents brake for vehicles/pedestrians, preserve model-specific following distance, distinguish valid queues from world blockage, recover deterministically, and expose limiting reasons through F3.
- **Delivered playable**: Foundry Crossing and Threads Junction own validated approaches, replicated signal phases, virtual stop obstacles, cross-axis clearance, stop-line presentation, and waiting diagnostics.
- **Delivered playable**: 16 ambient traffic vehicles use separated deterministic spawns; stopped agents can reverse, probe both sides, pass a stationary obstruction, and merge without treating signal/pedestrian queues as deadlocks.
- **Delivered playable**: one police cruiser consumes reported suspect facts without traffic/wanted coupling, uses bounded deterministic A*, searches last-known positions, intercepts visible targets, scales speed with heat, and permits occupied-vehicle ramming only at heat 3+.
- **Delivered foundation**: road steering/awareness is shared below ambient and police strategy; F3 exposes off-camera cruiser state plus route/last-known overlays.
- Add original-art compact, sports, van, truck, bus, motorcycle, ambulance, and special profiles only when each has a validated frame, footprint, seat layout, and road compatibility.
- **Deferred note**: author lane centerlines, legal turn connectors, parking points, and lane-based overtaking later. The compatibility road mask is too broad to infer these safely, and this work is not the next selected feature slice.
- Add multiple police units, coordinated block/intercept positions, siren yielding, disabled-car avoidance, officer exit behavior, roadblocks, and response population level of detail after authored lane metadata.
- Expand the private OpenGTA2 vehicle manifest for development while keeping gameplay IDs independent of GTA2 model numbers.

Exit gate: visibly different vehicle classes share the same authoritative physics/damage primitives, and traffic can follow/brake/recover without uncontrolled collision chains.

### 2. Street Services and Closed Economy Loop

**Playable foundation; content expansion next**

- **Delivered foundation**: all current kill and mission rewards pass through one bounded idempotent street-economy port with integer validation, balance caps, typed audit events, and fail-closed capacity.
- **Delivered playable**: ammunition and repair services quote from shared content policy, validate authoritative context, debit once, apply complete domain effects, and replicate world/minimap/action presentation.
- **Delivered playable**: hospitals own nearest-facility public/trauma admissions, one-time care debit, living treatment, respawn ammunition policy, and bounded spawn protection without moving medical policy into lifecycle or room code.
- **Delivered playable**: `Threads` is collision-safe and discoverable near spawn without intercepting the spawn vehicle action, opens the shared creator in Wardrobe mode, blocks wanted/vehicle use, and keeps every current item free during development.
- **Delivered foundation**: inventory uses private namespaced item IDs and targeted snapshots; equipped appearance alone remains public replicated state.
- **Delivered playable**: a shared grenade cache proves proximity collection, bounded quantity, deterministic contention, transient availability, respawn, notice, event, world model, and minimap projection without entering the service/economy controller.
- Carried street cash remains non-redeemable and session-local until durable identity exists.
- Price and reward policies live in an economy domain; combat, missions, and vehicles emit facts rather than changing balances directly.
- Extend the proven pickup boundary to money/items and risky cash loss/recovery only after exploit and spawn-camping scenarios are tested.

Exit gate: a player can earn from a mission, damage a car, escape police, repair/resupply, and see every debit/reward applied once.

### 3. Reusable Freemode Mission Objectives

**Playable four-job foundation; encounter content depth next**

- **Delivered playable**: shared definitions plus reusable steal vehicle, ordered vehicle checkpoints, escape wanted, and deliver vehicle objectives.
- **Delivered playable**: Getaway Run is the second composed Freemode job and uses the existing crew, reservation, payout, and cleanup infrastructure.
- **Delivered playable**: Crew Checkpoint Rush proves target-free missions, fixed rewards, participant-position predicates, shared arbitrary-vehicle progress, and target-optional cleanup.
- **Delivered playable**: Crew Holdout proves event-driven hostile waves, mission-only actors, combat target ports, contested hold time, contribution eligibility, death tolerance, and terminal despawn.
- Add reach-zone, acquire-item, explicit eliminate-target, escort, and multi-vehicle race objectives.
- Deepen Holdout with authored tactical spawn sets, per-wave roles, resupply breaks, drops, vehicles, armor/accuracy policy, and roster-scaled difficulty before adding more enemies.
- Add courier/item work only after an inventory/world-object ownership boundary exists; add competitive race placement only after per-vehicle entrants and finish ordering exist.
- Preserve GTA Online Freemode rules: optional nearby joining, explicit roster lock, role-friendly shared work, individual death tolerance, leader transfer, bounded payout, and cleanup ownership.
- Add rotating district events such as GTA2-style Tag and Deathmatch with scores isolated from the street economy.

Exit gate met: four definitions compose shared objectives and one event-driven combat encounter without mission code mutating combat, police, or vehicle internals. The next mission gate is authored tactical content and reconnect/late-join policy.

### 4. Character Creator and Clothing

**Playable foundation; original art and ownership next**

- **Delivered playable**: free development creator for skin tone, body presentation, hair/headwear, top, bottoms, shoes, palette colors, and outfit name.
- **Delivered playable**: appearance replicates as server-validated stable content IDs and palette values, never asset filenames; cosmetics do not affect gameplay statistics.
- **Delivered foundation**: one preview/world palette renderer and bounded generated-texture cache cover current walk, aim, weapon, and passenger presentation.
- Author original modular sprites for walk, run, aim, fire, enter, hijack, passenger lean, hit, and death readability.
- **Delivered playable**: private session wardrobe grants, server-side owned-item validation, targeted owner-only inventory state, authoritative apply acknowledgement, and one clothing-service open flow reuse the existing preview/apply/cancel creator.
- Add saved outfits, purchases, pricing, and durable wardrobe ownership only through future persistence/economy ports.
- Cosmetics never change hitbox, health, speed, aim, weapon damage, vehicle performance, detection, or payout.
- Saved outfits wait for account persistence; all current options stay unlocked during development.

Exit gate met for current presentation states; authored layer art and durable outfit ownership remain the next quality/production gates.

### 5. Seamless Building Interiors

**Playable single-floor vertical slice; authored content and isolation next**

- **Delivered foundation** finite shared interior catalog, replicated player `spaceId`, automatic doorway thresholds, axis-resolved floor/wall/fixture collision, same-space player presentation, and street-system isolation.
- **Delivered playable** Threads Showroom occupies the existing building footprint and keeps the surrounding Three city visible; entering hides street minimap, mission, marker, traffic, and interaction presentation while preserving player HUD and controls.
- **Delivered QA** development-only `?renderer=three&qa=1` driver uses normal network movement to complete repeatable street -> showroom -> street round trips. It does not expose a server teleport command.
- Export building/roof triangle ownership and door anchors from the original map pipeline. Roof visibility must toggle by authored interior ID, never by generic height or moving tile deletion.
- Move clothing, ammunition, repair, and later garage/property services into authored interiors through service-space IDs and interior interaction ports.
- Add interior combat/projectile collision, NPC destinations/schedules, audio zones, lighting, cameras, and multiple floors only after the single-floor space contract is stable.
- Garages must keep the interior physically tied to a building footprint while vehicle spawn/storage records remain separate from transient room vehicles.

Exit gate: two players can independently enter/exit one building, see only same-space actors, collide with authored fixtures, and use an interior service without exterior traffic/combat leaking through walls.

### 6. Durable Identity and Economy

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

- **Playable foundation** renderer-neutral full-district block geometry extraction in OpenGTA2.
- **Playable foundation** room-connected Three.js client behind `?renderer=three`.
- **Playable foundation** actor, vehicle, weapon, projectile, label, input, HUD, minimap, mission, effects, animation, debug, and camera parity.
- **Next** authored building/roof/door metadata for clean same-coordinate roof removal.
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

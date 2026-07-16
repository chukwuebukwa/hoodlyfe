# NOCK0 Feature Roadmap and Status

Updated: 2026-07-12

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

- **Playable** pistol, SMG, shotgun, rocket launcher, grenade, and Molotov with distinct cooldown, ammunition, fire mode, projectile, HUD icon, and held-weapon presentation.
- **Playable** fists and baseball bat with server-owned windup/contact/recovery timing, full collision-safe directional movement during attacks, three-step per-player fist combos, target-facing assistance, line-of-sight and forward-contact validation, one-contact fists, bounded multi-target bat strikes, low bat-to-vehicle damage, assault escalation, and synchronized Phaser/Three swing presentation.
- **Playable** visible pursuing police and assigned mission hostiles transition from ranged fire to authoritative point-blank melee with a fixed victim, timed windup/contact/recovery, impact-time range/arc/LOS revalidation, reaction interruption, replicated attack sequence/progress, debug events, and one shared Phaser/Three pose policy.
- **Playable** server-authoritative aim, firing gates, projectile movement, collision, player/NPC/vehicle damage, kill rewards, and respawn.
- **Playable** passenger drive-by shooting with seat-specific muzzle origins and a visible passenger lean/peek presentation.
- **Playable** bounded thrown-grenade arc/fuse/bounce, production-shaped radial falloff, self damage, player/NPC/vehicle attribution, transient blast presentation, and car chain reactions.
- **Playable** bounded server-authoritative rockets with accepted-launch ammo consumption, swept actor/world collision, self-damaging typed blasts, attribution, vehicle chain reactions, AOI replication, and Phaser/Three models.
- **Playable** bounded server-authoritative Molotov flight, impact-created ground fire, and finite carried pedestrian burns with fixed damage cadence, actor/vehicle attribution, AOI replication, pedestrian hazard stimulus, positional ignition audio, lifecycle cleanup, and shared Phaser/Three presentation.
- **Playable** server-authoritative armor absorbs accepted damage before health, exposes split damage facts, clears on death, and can be restored with ammunition at Combat Supply. Development players receive a temporary 25-point starter vest so the loop is immediately visible.
- **Playable** synchronized directional flinch, stagger, and knockdown reactions for players and pedestrians, with force/family/critical-health escalation, stronger-hit interruption, action cancellation, and one shared Phaser/Three presentation policy.
- **Foundation** weapon-family separation now covers bullet, rocket, thrown, ground/actor fire, and melee definitions through shared content catalogs; blocking, ground attacks, expanded NPC fight moves, spreading/extinguishable fire, mines, throw charging, reloads, recoil/accuracy, durable armor inventory, and weapon shops remain content work.

### Vehicles and Traffic

- **Playable** four-seat vehicles, driver/passenger entry, exit, passenger promotion, multiplayer occupancy, and occupant nameplates.
- **Playable** hijacking of ambient traffic, ejected driver creation, authoritative entry timing, and visible action presentation.
- **Playable** moving ambient traffic with deterministic road following/turn selection, ahead-corridor vehicle following, pedestrian stopping, asymmetric braking/acceleration, and blocked-route recovery.
- **Playable** two authored signalized intersections with replicated phases, stop-line braking, cross-axis occupancy holds, emergency bypass, wreck awareness, and F3 queue diagnostics.
- **Playable** deterministic stopped-car recovery with legitimate-stop suppression, bounded reverse, collision/road clearance probes, left/right passing, route merge, and retry cooldown.
- **Playable** opposite right-hand compatibility lanes, authored deterministic junction
  queues with approach/crossing/rear-clearance ownership, non-road ambient pedestrian
  placement/wander, and one-minute circulation soak coverage.
- **Playable** catalog-sized oriented-box car collisions with broad-phase bounds, minimum-axis separation, momentum transfer, pedestrian impacts, component damage, staged body damage, engine degradation, ignition, delayed explosion, occupant ejection, and restoration.
- **Foundation** local driving uses sequenced fixed-step input, saved-move rewind/replay, swept oriented static-world collision, and render-only correction smoothing. Dynamic contacts remain server-only until the bounded nearby prediction island and timestamped remote vehicle buffers are complete.
- **Playable** Sedan, Taxi, and Police Cruiser consume one shared catalog but have distinct health, mass, impact resistance, acceleration, braking, speed, steering, traffic policy, seating, and presentation metadata.
- **Foundation** streamed population owns 80 pedestrian and 64 traffic potential records
  with 40/24 active ceilings. Actors materialize only outside every player's protected view,
  prewarm before AOI entry, retain through hysteresis, and become coarse virtual records when
  cold. Fast occupied vehicles add bounded authoritative lookahead so their forward route
  prewarms without weakening the anti-pop-in guard. Disconnected player neighborhoods now
  receive deterministic fair shares; bounded rebalancing removes only offscreen disposable
  over-quota actors, while visible or pinned overages surface pressure instead of popping.
  Additional vehicle classes, zone/segment density, and parking remain incomplete. A
  functional repair garage is playable.

### Crime, Police, and Pedestrians

- **Playable** crimes become bounded incidents; witnesses report after delay; unwitnessed incidents expire.
- **Playable** wanted heat, response caps, police dispatch assignments, pursuit, last-known-position search, line-of-sight fire, heat decay, and respawn reset.
- **Playable** bounded police response fleet with heat-scaled 1/2/3 unit budgets, delayed reinforcements, clear road-reachable placement, safe stand-down, hijack/destruction handoff, report-based search, visible-target pursuit/interception, high-heat vehicle ramming, pursuit-only siren, and F3 fleet/route/strategy diagnostics.
- **Playable** moving police sirens project a bounded response corridor: aligned civilian traffic pulls to a road-safe side, crossing/oncoming traffic waits, invalid sirens are ignored, and F3 exposes the temporary yielding relationship.
- **Playable** ambient civilian/police population, ejected drivers, event stimuli, bravery, investigation, startle, sustained flee, recovery, death, and respawn.
- **Playable** bounded deterministic pedestrian paths around large collision obstacles with per-tick work limits and private route memory.
- **Foundation** 80 potential ambient pedestrian records now materialize near street players with hysteresis, bounded work, pinning, and coarse dormant movement. Detailed arrests, containment, roadblocks, call-police behavior, gangs, cover, crowd propagation, and authored sidewalks/crossings remain incomplete.

### World, Navigation, Missions, and Diagnostics

- **Playable** GTA2 compatibility map, corrected collision layers, spawn, roads, labels, overhead props, and minimap.
- **Playable foundation** server-authoritative 48-minute day/night clock with continuous Three sky/fog/sun/ambient phases, deterministic full-road streetlight coverage, signal-color glow, bounded nearest-light activation, and DBG time controls.
- **Playable** GTA Online-inspired Freemode Boost and Deliver job with opt-in nearby crew, leader launch, shared objective, target reservation, wanted escape, delivery, failure states, and idempotent participant payouts.
- **Playable** Getaway Run composes the same crew/runtime boundaries with three ordered authoritative road checkpoints, wanted escape, delivery, condition payout, and cleanup.
- **Playable** Crew Checkpoint Rush adds five ordered road checkpoints carried by any living crew driver, no reserved target, fixed payout, and shared route progress.
- **Playable** Crew Holdout adds three escalating owned hostile waves, line-of-sight combat pursuit, contested hold progress, death tolerance, contribution-gated payout, and explicit actor cleanup.
- **Playable** Most Wanted adds a reusable eliminate-target objective, living-roster-scaled guards, one marked armored SMG boss, participant-only target pinning, shared payout, and explicit cleanup.
- **Playable** compact job selector, shared immutable mission catalog, template-declared target/reward/encounter policy, and reusable acquire-vehicle, target-checkpoint, crew-checkpoint, hold-area, clear-wanted, and low-speed-delivery objective evaluators.
- **Playable** minimap markers for players, police, contact, target, delivery, and local/remote vehicle positions.
- **Playable** opt-in F3/DBG diagnostics for collision, spatial cells, entities, incidents, pursuits, stimuli, AI objectives, bravery, and pedestrian routes.
- **Foundation** five complete jobs now share objective/encounter modules; item, escort, placement-scored race, and event-mode objectives remain incomplete.
- **Playable** Three.js district client with real OpenGTA2 block geometry and depth-tested entities is now the only renderer; the Phaser client and its wrapper modules were removed.
- **Playable foundation** one seamless same-building single-floor Mercy Hospital: walk through the south-facade doorway, switch replicated space/collision automatically, hide exactly 32 exporter-authored roof triangles, recover or receive treatment inside, and walk back out without a load screen.
- **Playable foundation** per-client spatial state views: same-space players/services replicate everywhere, while street actors, traffic, combat transients, missions, pickups, and signals are not sent to hospital clients.
- **Playable foundation** street AOI streams NPCs and vehicles with 1,280/1,536-pixel hysteresis, bounded add/remove budgets, occupied/mission vehicle pinning, and F3 visibility pressure diagnostics.

### Street Economy and Services

- **Playable** bounded server-authoritative street cash with idempotent credits/debits, balance limits, typed audit events, mission payouts, and kill rewards.
- **Playable** replicated Combat Supply counter with combined missing-ammunition/armor pricing, cash validation, complete authoritative restock, world marker, minimap point, contextual action, and notices.
- **Playable** replicated repair garage with layered damage pricing, driver/speed/fire/wanted validation, complete vehicle/component/fire restoration, world marker, minimap point, contextual action, and notices.
- **Playable** Mercy Hospital as an indoor recovery/treatment destination plus street-based Southside Clinic, with nearest-facility respawn, free 4.2-second Public Ward, $250 2.2-second Trauma Care, wanted/vehicle gates, markers, and idempotent billing.
- **Playable** collision-safe street Threads service that opens the existing creator in Wardrobe mode; its own seamless building remains queued and must use the authored interior guide.
- **Playable** service-first interaction priority and same-tick duplicate suppression without moving service rules into `DistrictRoom`.
- **Playable** one shared grenade pickup grants three up to a six-grenade cap, resolves contention authoritatively, projects world/minimap presentation, and respawns after 20 seconds.
- **Playable** player death drops 20% of carried street cash up to $500 with delay, expiry, deterministic collection, AOI streaming, minimap/world presentation, and idempotent zero-sum debit/credit.
- **Foundation** street cash remains session-local and non-redeemable; general item pickups, durable ledger, durable inventory, purchases, and pricing remain incomplete.

### Appearance and Customization

- **Playable** free LPC-backed character creator with authored body, hair, headwear, top, bottoms, footwear, compatible color variants, outfit name, randomize, cancel, and apply.
- **Playable** server-validated nested appearance state plus stable LPC recipe replicates to local/remote on-foot and passenger presentation with local reload persistence for development.
- **Playable** synchronized LPC layers compile client-side into runtime animation textures; inactive generated textures remain bounded and pruned.
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
- **Delivered playable**: 64 virtual traffic records materialize at most 24 nearby lane-offset cars; stopped agents can reverse, probe both sides, pass a stationary obstruction, and merge without treating signal queues as deadlocks.
- **Delivered foundation**: sustained ambient jams outside every player's 1,536-pixel replication radius retire at a bounded rate, including minor collision-damaged traffic, while occupied, hijacked, mission, burning, destroyed, and visible vehicles remain protected.
- **Delivered foundation**: all disposable moving ambient pedestrians and traffic are owned
  by one player-union population lifecycle. The 720-to-1,280-pixel prewarm ring is the only
  admission tier; 1,280-to-1,536 retains actors; cold records advance at coarse cadence
  without full AI, physics, schemas, replication, or interaction-island history.
- **Delivered playable**: persistent visible vehicle blocker cycles elect exactly one
  rear-clear recovery owner, release only that car's junction claim, reverse for a bounded
  window, and return to the existing route; F3 and Three expose the cycle and owner.
- **Delivered playable**: authored conflict zones serialize FIFO approaches, reject blocked
  admission, preserve a commit window, hold ownership until the rear collider clears, and
  expire abandoned ownership; catalog-sized oriented rectangles replace circular
  vehicle-to-vehicle collision.
- **Delivered playable**: server traffic predicts catalog-sized oriented-box contact from
  relative motion, combines TTC with following-distance speed caps, preserves admitted
  junction throughput, and exposes limiting risk through F3 and Three overlays.
- **Delivered playable**: selected district corridors compile two lanes per direction;
  turn legality consumes lane index; slow-lead passing reserves one adjacent-lane segment,
  validates lead/front/rear/path clearance, and executes bounded change-out/pass/return
  phases. Multi-lane and terminal conflict bounds own fixed braking-distance stop lines,
  and the dense one-minute traffic soak records zero overlap pair-ticks.
- **Delivered playable**: an authored cruiser plus bounded dynamic reinforcements consume reported suspect facts without traffic/wanted coupling, use bounded deterministic A*, search last-known positions, intercept visible targets, scale speed and unit count with heat, and permit occupied-vehicle ramming only at heat 3+.
- **Delivered foundation**: road steering/awareness is shared below ambient and police strategy; F3 exposes off-camera cruiser state plus route/last-known overlays.
- Add original-art compact, sports, van, truck, bus, motorcycle, ambulance, and special profiles only when each has a validated frame, footprint, seat layout, and road compatibility.
- **Delivered foundation**: the Industrial District now has authored directed lane
  centerlines, legal turn connectors, owned junctions, deterministic A*, durable routes,
  graph validation, lane counts, adjacent-lane geometry, and server-owned passing. Parking
  points, permanent route-lane transitions, and turn pockets remain.
- Add coordinated block/intercept positions, disabled-car avoidance, officer exit behavior, roadblocks, and response population level of detail after authored lane metadata.
- Expand the private OpenGTA2 vehicle manifest for development while keeping gameplay IDs independent of GTA2 model numbers.

Exit gate: visibly different vehicle classes share the same authoritative physics/damage primitives, and traffic can follow/brake/recover without uncontrolled collision chains.

### 2. Street Services and Closed Economy Loop

**Playable foundation; content expansion next**

- **Delivered foundation**: all current kill and mission rewards pass through one bounded idempotent street-economy port with integer validation, balance caps, typed audit events, and fail-closed capacity.
- **Delivered playable**: ammunition and repair services quote from shared content policy, validate authoritative context, debit once, apply complete domain effects, and replicate world/minimap/action presentation.
- **Delivered playable**: hospitals own nearest-facility public/trauma admissions, one-time care debit, living treatment, respawn ammunition policy, and bounded spawn protection without moving medical policy into lifecycle or room code.
- **Delivered playable**: Mercy owns the authored hospital space, treatment anchor, and recovery spawn; Threads opens the shared creator from a separate street marker until its own building is authored.
- **Delivered foundation**: inventory uses private namespaced item IDs and targeted snapshots; equipped appearance alone remains public replicated state.
- **Delivered playable**: catalog-driven grenade and Molotov caches prove proximity collection, weapon-specific capacity, bounded quantity, deterministic contention, transient availability, respawn, notice, event, world model, and minimap projection without entering the service/economy controller.
- Carried street cash remains non-redeemable and session-local until durable identity exists.
- Price and reward policies live in an economy domain; combat, missions, and vehicles emit facts rather than changing balances directly.
- Extend the proven pickup boundary to money/items and risky cash loss/recovery only after exploit and spawn-camping scenarios are tested.

Exit gate: a player can earn from a mission, damage a car, escape police, repair/resupply, and see every debit/reward applied once.

### 3. Reusable Freemode Mission Objectives

**Playable five-job foundation; encounter content depth next**

- **Delivered playable**: shared definitions plus reusable steal vehicle, ordered vehicle checkpoints, escape wanted, and deliver vehicle objectives.
- **Delivered playable**: Getaway Run is the second composed Freemode job and uses the existing crew, reservation, payout, and cleanup infrastructure.
- **Delivered playable**: Crew Checkpoint Rush proves target-free missions, fixed rewards, participant-position predicates, shared arbitrary-vehicle progress, and target-optional cleanup.
- **Delivered playable**: Crew Holdout proves event-driven hostile waves, mission-only actors, combat target ports, contested hold time, contribution eligibility, death tolerance, and terminal despawn.
- **Delivered playable**: Most Wanted proves a reusable eliminate-target objective, roster-scaled guard composition, one stable marked boss, participant-only relevance, and target-following presentation.
- Add reach-zone, acquire-item, escort, and multi-vehicle race objectives.
- Deepen Holdout with authored tactical spawn sets, per-wave roles, resupply breaks, drops, vehicles, armor/accuracy policy, and roster-scaled difficulty before adding more enemies.
- Add courier/item work only after an inventory/world-object ownership boundary exists; add competitive race placement only after per-vehicle entrants and finish ordering exist.
- Preserve GTA Online Freemode rules: optional nearby joining, explicit roster lock, role-friendly shared work, individual death tolerance, leader transfer, bounded payout, and cleanup ownership.
- Add rotating district events such as GTA2-style Tag and Deathmatch with scores isolated from the street economy.

Exit gate met: five definitions compose shared objectives and two event-driven combat encounters without mission code mutating combat, police, or vehicle internals. The next mission gate is authored tactical content and reconnect/late-join policy.

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

**Playable authored single-floor vertical slice; content depth next**

- **Delivered foundation** finite shared interior catalog, replicated player `spaceId`, automatic doorway thresholds, axis-resolved floor/wall/fixture collision, same-space player presentation, and street-system isolation.
- **Delivered playable** Mercy Hospital occupies its real building footprint; the exporter owns 32 exact roof-lid triangles, and entering hides only that named group while preserving the surrounding city, HUD, controls, and same-space service presentation.
- **Delivered playable** Mercy's treatment service and recovery spawn are interior-owned anchors. Medical respawn plans carry coordinates plus `spaceId`; lifecycle applies them without owning facility policy. Threads remains a street service until it gets a separate authored building.
- **Delivered foundation** `DistrictReplicationController` diffs Colyseus state-view membership per outgoing patch. Interior clients no longer receive street collections, and street peers no longer receive interior players.
- **Delivered QA** development-only `?renderer=three&qa=1` driver uses normal network movement to complete repeatable street -> hospital -> street round trips. It does not expose a server teleport command.
- **Delivered tooling** `INTERIOR_AUTHORING_GUIDE.md` documents source/runtime coordinate conversion, catalog/export ownership, failure signatures, required tests, and desktop/mobile browser QA for subsequent buildings.
- Move ammunition, repair, and later garage/property services into authored interiors only as each building gains collision-safe anchors and appropriate vehicle/actor portal rules.
- Add interior combat/projectile collision, NPC destinations/schedules, audio zones, lighting, cameras, and multiple floors only after the single-floor space contract is stable.
- Add street area-of-interest cells with hysteresis, mission relevance, and add/remove budgets before raising room population substantially; space filtering alone does not make the whole street district cheap.
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

The Three renderer is now the only client; the Phaser renderer and its wrapper modules were removed in July 2026. GTA2-derived maps and sprites are private compatibility fixtures; public distribution and monetization require original art, layout, geometry, vehicles, and branding.

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

## Active Systemic Gameplay Program

The implementation order, pinned re3/reVC source index, multiplayer authority matrix,
and repeatable milestone goal loop live in
[`SYSTEMIC_GAMEPLAY_IMPLEMENTATION_PLAN.md`](SYSTEMIC_GAMEPLAY_IMPLEMENTATION_PLAN.md).
That plan is the active execution sequence for traffic, wanted response, police tactics,
pedestrian AI, weapons, vehicle damage, encounters, and population virtualization.

## Development and QA Rule

Each slice must start with a production reference study, define one domain owner and typed boundaries, expose enough opt-in diagnostics to prove behavior, add deterministic unit/scenario coverage, preserve the real two-client flow, pass the production build, and end with a timestamped devlog checkpoint and focused commit.

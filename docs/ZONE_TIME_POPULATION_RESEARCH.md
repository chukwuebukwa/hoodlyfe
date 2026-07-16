# Zone and Time Population Adaptation

Date: 2026-07-15

This milestone uses pinned re3 and reVC source as educational behavior references. NOCK0's
data, tuning, TypeScript policy, map zones, and multiplayer allocation are original.

## Reference Behavior

Both games keep separate day and night zone records, resolve the zone at a world position,
and blend density and model-selection thresholds during dawn and evening transitions.

- re3 blends car density, vehicle-class thresholds, police/gang thresholds, pedestrian
  density, and police/gang density in
  [`Zones.cpp:396-450`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Zones.cpp#L396-L450).
- reVC preserves that ownership and expands the data to boats and separate pedestrian
  thresholds in
  [`Zones.cpp:433-490`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Zones.cpp#L433-L490).
- Pedestrian generation reads the resolved zone profile before applying the global cap and
  selecting police, gangs, or civilian groups in
  [re3 `Population.cpp:572-624`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Population.cpp#L572-L624)
  and
  [reVC `Population.cpp:521-595`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/Population.cpp#L521-L595).
- Random traffic resolves zone density and class weights before attempting a road spawn in
  [re3 `CarCtrl.cpp:111-150`](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/CarCtrl.cpp#L111-L150)
  and
  [reVC `CarCtrl.cpp:134-174`](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/CarCtrl.cpp#L134-L174).

reVC adds more categories and context modifiers, but does not collapse zone lookup,
time interpolation, global budget, archetype selection, and spawn validation into one
operation. That separation is the transferable production pattern.

## NOCK0 Adaptation

`district-population-zones.ts` authors four first-pass areas against current map landmarks
and road bands: North Works, West Market, Civic East, and South Freight. Each has day/night
pedestrian density, traffic density, ambient police share, and civilian vehicle weights.
Unknown or future coordinates resolve to a conservative default profile.

`population-zone-profile-policy.ts` is pure. It owns:

- deterministic point-to-zone resolution;
- smooth dawn/day/dusk/night blending;
- density admission;
- pedestrian archetype selection;
- weighted ambient vehicle selection.

`PopulationStreamingController` remains the lifecycle owner. The profile policy filters
dormant candidates only after player-interest and cluster ownership are known. The global
40-pedestrian/24-traffic safety ceilings and fair disconnected-player entitlements remain
the outer constraints. Density cannot create a second population per player or steal a
distant cluster's share.

When the time or zone profile becomes sparser, convergence uses the existing bounded
offscreen removal budget. Hot, occupied, hijacked, mission-owned, damaged, burning,
destroyed, combat-engaged, or otherwise pinned actors remain. Visible actors never change
kind. A dormant record chooses its kind only when it materializes.

Ambient profile police do not replace wanted-response allocation. The response fleet and
pursuit systems continue to own demanded officers and police vehicles. Random traffic
profiles deliberately exclude police vehicles.

## Netcode Boundary

This is server-authoritative population lifecycle policy. Cold records and profile decisions
do not enter prediction, reconciliation, combat rewind, interaction-island replay, or shared
movement/contact kernels. Once admitted, an actor uses the existing authoritative state,
AOI replication, and interaction-island selection.

## Diagnostics and Acceptance

F3 Population reports world time, day blend, active zone counts, profile-held candidates,
and cumulative safe profile rebalances beside the existing interest/cluster counters.
Deterministic tests cover landmark resolution, smooth interpolation, threshold selection,
day/night population difference, and safe day-to-night convergence.

## Deliberate Limits

- Current zones are authored rectangles, not a general polygon/volume asset pipeline.
- Current pedestrian archetypes are civilian and police; gangs, workers, medics, and shop
  schedules need their own gameplay definitions before becoming profile weights.
- Weather, service hours, authored pedestrian destinations, and non-player mission/pursuit/
  property anchors remain later G8 slices.
- This tuning is a first playable composition pass and should be revised from telemetry,
  not treated as copied GTA data.

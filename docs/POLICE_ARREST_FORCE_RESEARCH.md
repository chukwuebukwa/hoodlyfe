# Police Arrest and Force Research

Date: 2026-07-18

Status: G3b implementation contract

## Scope

This note defines NOCK0's first authoritative arrest and busted loop. It covers force
selection at close contact, restraint ownership, cancellation, the terminal custody
outcome, and multiplayer-safe release.

Pinned educational references:

- re3 commit [`3233ffe1c4b99e8efb4c41c6794b4fce880cf503`](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)
- reVC commit [`b9eeb33efcd04a5b7a423921609baef11bf4719a`](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a)

The implementation is original TypeScript. Source code, enums, constants, tuning tables,
data layouts, and presentation assets are not copied.

## Source-Derived Behavior

### Arrest entry belongs to the officer, not the global lifecycle

Both references let a police pedestrian validate contact, place the suspect into an
arrested state, disable ordinary damage/control, retain the arresting officer, face the
suspect, and run a dedicated arrest action:

- [re3 arrest entry](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L87-L139)
- [re3 arrest continuation](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L226-L259)
- [reVC arrest entry](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L109-L150)
- [reVC arrest continuation](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L244-L277)

The references also check special close-contact states such as a suspect entering a
vehicle, and nearby officers recognize an already-arrested suspect instead of continuing
ordinary combat:

- [re3 police state execution and contact checks](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L574-L704)
- [reVC police state execution and contact checks](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L618-L747)

The transferable pattern is not the exact state list. It is that one physical officer
owns a cancellable contact process and ordinary force stops once restraint has begun.

### Busted is a separate, idempotent player lifecycle outcome

The player-info layer changes from playing to busted only once, while global game logic
observes the arrested state and performs delayed restart consequences:

- [re3 one-shot busted transition](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/PlayerInfo.cpp#L528-L537)
- [re3 arrested-state handoff](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/GameLogic.cpp#L67-L85)
- [re3 busted restart consequences](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/GameLogic.cpp#L145-L226)
- [reVC one-shot busted transition](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/PlayerInfo.cpp#L773-L783)
- [reVC arrested-state handoff](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/GameLogic.cpp#L119-L129)
- [reVC busted restart consequences](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/control/GameLogic.cpp#L192-L285)

Arrested player control also bypasses normal movement processing:

- [re3 arrested player control](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PlayerPed.cpp#L1481-L1484)
- [reVC arrested player control](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/PlayerPed.cpp#L1904-L1907)

This split is essential on a server: AI can retry contact every fixed step, but fines,
weapon confiscation, wanted clearing, and relocation must execute exactly once.

## Clean-Room Adaptation

```text
response allocator
  -> pursuit coordinator assigns stable primary role
  -> pedestrian perception supplies authoritative target facts
  -> pure police force policy selects arrest / melee / fire / hold
  -> arrest controller owns contact lock and cancellation
  -> player lifecycle owns the one-shot busted mutation
  -> custody controller owns fee and safe release plan
```

### Force policy

Only the primary foot officer may start custody. The target must be alive, wanted,
visible, on foot in street space, within contact range, and in an arrestable action. A
close resisting target receives the existing melee response. At one star, visible threats
outside contact are pursued but do not authorize firearms. Firearms begin at two stars and
use a separate wanted-tier marksmanship policy for range, cadence, and deterministic aim
error. Officers without control cannot apply force, and an already-arrested target
suppresses additional force.

The policy is pure and has no timers, state collections, damage calls, navigation, or
network authority. Distances and fees are original NOCK0 tuning, not reference constants.

### Arrest runtime

`PoliceArrestController` owns one suspect per officer and one officer per suspect. It
independently revalidates allocator role, visibility, line of sight, contact, wanted state,
space, health, and actor control before accepting a request. During the bounded secure
window it freezes the suspect through the existing replicated action state, holds and
faces the officer, resets pending player input, and records an arrest tactic.

Officer injury/death, suspect disappearance, changed space, lost contact, lost line of
sight, or invalid target state cancels the runtime without applying custody. Completion
delegates once to player lifecycle and then releases runtime ownership.

### Custody outcome

`PlayerLifecycleController.completeArrest` is the only terminal owner. It clears combat,
vehicle access, wanted response, input, fire/reaction state, and weapons; restores health;
applies bounded release protection; then publishes `player.busted`.

`CustodyOutcomeController` computes an original wanted-scaled fee through the idempotent
street-economy port and chooses a collision-safe release near a provisional district
custody anchor. The current anchor is district spawn until an authored police station is
available. Global time, camera fade, and world simulation are not advanced because one
multiplayer player's arrest cannot pause or time-skip every other player.

## Multiplayer and Netcode Contract

- The server owns target identity, force selection, arrest acceptance, cancellation,
  timing, fines, inventory mutation, wanted clearing, and release position.
- Clients send no surrender-complete or busted command.
- `action = arrested` is ordinary authoritative actor state. The existing shared on-foot
  movement policy already returns zero movement for non-empty non-melee actions, so both
  server movement and local prediction stop without a new prediction kernel.
- Fire control rejects attacks during any non-empty action. Damage control treats the
  active arrest action as protected, preventing secondary officers from harming a secured
  suspect.
- Interaction-island membership, AOI, interpolation, reconciliation, combat rewind,
  rollout, and shared movement/contact code are unchanged.
- F3 custody data is copied developer telemetry. It never feeds simulation.

## Diagnostics and Acceptance

F3 exposes active custody count, officer/suspect ownership, remaining secure time, a pink
contact link, and compact arrest/busted/cancellation event history.

Deterministic coverage proves:

- only primary visible contact can select custody;
- resisting contact selects melee and an already-arrested target suppresses force;
- duplicate arrest requests do not duplicate runtime;
- officer control loss cancels and unlocks the suspect;
- completion runs once;
- wanted-scaled fees are bounded and idempotent;
- weapons/ammunition are confiscated;
- release is collision-safe and temporarily protected;
- debug snapshots copy active arrest data;
- the frozen interaction-island netcode directories remain unchanged.

## Deferred Work

- explicit player surrender input and surrender animation;
- handcuff/escort/transport presentation;
- authored precinct and jail interiors;
- vehicle pull-over and dragged-from-car arrest flows;
- crossfire-safe firing sectors and cover selection;
- arrest resistance/escape rules;
- persistent legal records or on-chain economic settlement.

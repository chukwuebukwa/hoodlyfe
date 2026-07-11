# Pedestrian Reaction State Research

Date: 2026-07-10

Primary behavioral reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference does not translate a perceived threat directly into one permanent movement vector.

- `CCivilianPed::CivilianAI` scans threats, uses short look timers around gunfire/explosions, then chooses fleeing, investigation, crime reporting, or retaliation from temperament and context.
- Flee behavior owns an origin/entity, a deadline, move state, and route recovery rather than only an angle.
- Investigation stores the previous state, approaches an event to a configured distance, stops and faces it, runs timed look/idle behavior, then explicitly restores control.
- Threat response considers fear, temper, lawfulness, distance, weapon context, gang identity, mission ownership, and whether police are already responding.
- New related events can extend a response without replaying every initial transition.

References:

- [`CivilianPed.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CivilianPed.cpp)
- [`Ped.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/Ped.cpp)
- [`PedAI.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedAI.cpp)
- [`PedFight.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/PedFight.cpp)

The source was used only to identify observable state transitions and ownership. NOCK0 uses original state names, timings, formulas, presentation, and tests.

## NOCK0 State Contract

`PedestrianReactionSystem` is a focused layer between perception and general behavior:

```text
perception cue
  -> orient/startle
  -> flee or investigate
  -> recover
  -> ambient behavior
```

- `orient` briefly faces the cue and stops movement. Its duration varies with the pedestrian's deterministic bravery trait.
- `respond` flees high-severity danger or investigates low-severity facts when bravery exceeds severity.
- Flee response uses danger-specific commitment windows: impacts are brief, injuries are longer, gunshots/deaths commit for at least 4.2 seconds, and fire/explosions commit for at least 4.8 seconds. It ends only after both that commitment and a safe-distance check, or its bounded response deadline.
- Flight owns a stable destination far enough outside the event radius to read as escape rather than a few animation steps. Investigation owns the event location as its approach goal.
- Investigation approaches at a slower speed and stops near the event while retaining the response timer.
- Repeated observations of the same cue update location and extend response lifetime without replaying startle.
- A materially more severe cue may interrupt the current response; lower-priority noise does not thrash state.
- `recover` is an explicit short stationary state before ambient wandering regains control.
- Police bypass this civilian state machine and retain pursuit/search/investigation tactics in `PedestrianBehaviorSystem`.

Reaction runtime remains private server data. Only the stable presentation action (`wander`, `startle`, `flee`, `investigate`, `recover`, `pursue`, `search`, or `dead`) is added to synchronized `NpcState`.

## Presentation Contract

`PedestrianRenderer` consumes the replicated action but cannot choose or advance it.

- Startle stops the walk cycle and applies a brief warm reaction tint.
- Flee and pursuit use faster walk-cycle cadence.
- Investigation and search use a slower cadence.
- Recovery stops movement and uses a muted transient presentation.
- Missing/older action data falls back to `wander` for protocol tolerance.

This is an interim animation vocabulary using the current GTA2 compatibility sprites. Original animation sets can later replace the policy without changing authoritative reaction transitions.

## Required Follow-Up Nuance

- Replace one bravery scalar with validated archetype profiles: fear, aggression, lawfulness, awareness, loyalty, weapon skill, and faction.
- Replace the interim collision-grid planner with authored sidewalk, crossing, destination, and traffic-signal graphs from the original map pipeline.
- Add call-police, take-cover, retaliate, assist-ally, cower, and crowd-propagation responses.
- Model visual versus audible orientation and preserve last-known direction under occlusion.
- Add explicit animation-event messages for one-shot voice/flinch effects while keeping animation callbacks non-authoritative.
- Protect reaction/path requests with distance-based AI levels of detail and per-tick budgets.

## Acceptance Coverage

- High-severity cue transitions through startle, flee, safe-distance recovery, and ambient release.
- Brave civilian investigates a mild impact and stops near the event.
- Repeated cue extends response without replaying startle.
- A gunshot response is still fleeing two seconds after the cue and cannot collapse into a six-step reaction.
- Civilian reactions cannot override police tactical behavior.
- Personal threats visibly startle a civilian before fleeing.
- Replicated presentation policy differentiates startle, flee, investigate, recover, pursue, and death.
- Existing two-client combat, traffic, wanted, police, mission, vehicle, and respawn scenarios remain green.

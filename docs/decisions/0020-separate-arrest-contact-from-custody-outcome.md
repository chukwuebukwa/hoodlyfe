# ADR 0020: Separate Arrest Contact from Custody Outcome

Date: 2026-07-18

Status: Accepted for G3b

## Context

Police AI evaluates intent every fixed step. A busted outcome mutates wanted state,
inventory, economy, position, protection, and response allocation and therefore must not
be embedded in a repeated pedestrian behavior branch. The interaction-island netcode also
must not gain gameplay authority over arrest outcomes.

Pinned re3/reVC behavior separates police-owned arrest entry/continuation from a one-shot
player/global busted transition. NOCK0 needs the same ownership property in a multiplayer
simulation without copying implementation details or applying single-player global time,
camera, or fade effects.

## Decision

Use four explicit owners:

- `police-force-policy.ts` purely selects arrest, melee, fire, or hold from authoritative
  facts;
- `police-arrest-controller.ts` owns one cancellable contact runtime per officer/suspect;
- `player-lifecycle-controller.ts` owns the one-shot busted mutation;
- `custody-outcome-controller.ts` owns the idempotent fee and collision-safe release plan.

The primary tactical role is the only role allowed to request arrest. The arrest action is
replicated through existing player/NPC state and naturally stops the existing shared
movement policy. No prediction, reconciliation, AOI, rewind, island, or transport rule is
changed.

## Consequences

- AI retries cannot double-charge, double-confiscate, or repeatedly release a player.
- Injury, separation, visibility loss, and disconnect can cancel contact before custody.
- Force stops after restraint begins, including damage immunity for the secured suspect.
- Future surrender, escort, transport, precinct, and jail modules can replace individual
  ports without enlarging pedestrian behavior or `DistrictRoom`.
- The provisional release anchor must be replaced when an authored precinct exists.
- Arrest presentation is initially limited to actor facing, frozen action state, debug
  links, and notices; richer animation remains separate client work.

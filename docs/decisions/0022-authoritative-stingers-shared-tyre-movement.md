# ADR 0022: Authoritative Stingers with Shared Tyre Movement

Date: 2026-07-18

Status: Accepted for G3d

## Context

A spike strip crosses several ownership boundaries: police tactics chooses an opportunity,
an officer deploys an actor, lane routing must remain closed, wheel contact mutates vehicle
condition, and that condition changes predicted movement. Folding the behavior into the
roadblock controller would couple barricade cars, pedestrians, collision, damage, and
netcode. Keeping tyre effects server-only would cause persistent prediction divergence.

## Decision

- Keep roadblock vehicles and spike strips in separate controllers with overlapping,
  owner-scoped closure claims.
- Represent each strip as a replicated twelve-segment lifecycle with an owned officer.
- Resolve authoritative contact after vehicle motion using swept wheel paths and exact
  four-wheel identities.
- Store tyre condition as a compact append-only four-bit vehicle field.
- Share only pure tyre mechanical modifiers with authority, saved-input prediction,
  interaction replay, and AI movement. Do not replay deployment, contact mutation, events,
  ownership, or teardown.
- Advance the interaction protocol version and fail closed on peers that cannot validate
  tyre state.

## Consequences

- High-speed vehicles cannot tunnel through a strip between ticks.
- Asymmetric tyre damage produces the same pull during authority and replay.
- An authoritative tyre transition can correct pending local movement without duplicating
  contact side effects.
- Static strips remain outside the dynamic interaction-island body budget.
- Initial contact response is authority-delayed; provisional local strip contact is an
  optional later presentation improvement.
- Repair and respawn paths must reset the tyre mask explicitly.

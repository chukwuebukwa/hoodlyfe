# ADR 0019: Stable Police Tactical Role Projection

Date: 2026-07-18

Status: Accepted for G3a

## Context

G1 owns finite, fair foot/cruiser response leases. Pursuit memory owns what each unit last
observed. Foot and cruiser controllers can execute one target independently, but every unit
otherwise converges on the same point and secondary cruisers can inherit primary aggression.

A tactical layer is required before arrests, roadblocks, stingers, and officer exit
behavior can be added. It must not become a second allocator, navigation system, or netcode
authority.

## Decision

Add a server-only `PursuitCoordinator` between allocation/perception and actor execution.
It projects each active assignment into one stable role, phase, and goal.

- Retain a role while the underlying response lease remains valid.
- Fill free roles deterministically by assignment age, distance, then stable unit ID.
- Derive visible goals from the suspect's authoritative heading.
- Collapse every role to its private last-known point while searching.
- Let pedestrian and cruiser controllers own navigation and movement.
- Let combat, arrest, damage, and lifecycle systems own outcomes.
- Expose copied tactic records through opt-in F3 diagnostics.

The coordinator cannot allocate population, infer visibility, mutate actor transforms,
apply damage, or decide arrest completion.

## Consequences

- Multiple responders stop chasing one identical coordinate.
- Tactical ownership does not oscillate when unit distances cross.
- Secondary cruisers can flank without inheriting primary ramming.
- Loss of a primary lease promotes a deterministic replacement without a second roster.
- Future arrest and roadblock systems can consume stable responsibilities and authored
  opportunities.
- Clients receive no new authority; the frozen interaction-island netcode remains
  unchanged.
- Tactical offsets still depend on current collision/road navigation and do not guarantee
  an ideal position in every map location.

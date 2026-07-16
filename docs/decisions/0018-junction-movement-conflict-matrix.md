# ADR 0018: Junction Movement Conflict Matrix

Date: 2026-07-16

Status: Accepted for G2b.2b

## Context

The G2b.1 junction owner safely serializes every vehicle at one junction. G2c widened
conflict bounds for multiple lanes, which makes that serialization increasingly
conservative. Opposite straight lanes and disjoint corner turns can be physically
compatible, but a single junction-wide owner cannot represent that.

The pinned re3/reVC sources keep directed current/next/previous lane links, directional
signal checks, and lane-aware curves. Eclipse SUMO demonstrates the more explicit
production model: each lane-to-lane connection has a stable movement identity and a
right-of-way/foe matrix.

## Decision

Compile a private server movement descriptor from the active authored route. Use a pure
geometric policy to derive symmetric movement conflicts. Replace the single reservation
with a bounded owner set that admits a request only when it conflicts with no active owner
and does not bypass an older unblocked conflicting waiter.

Keep the following fail-closed:

- road-cell fallback junctions;
- missing entry/traversal/exit route geometry;
- terminal U-turns;
- shared entry or exit lanes;
- malformed or degenerate movement paths.

Signals, pedestrians, unowned occupants, physical vehicle awareness, authoritative
collision, and rear-clearance leases remain separate safety layers.

## Consequences

- Compatible authored movements can cross simultaneously without weakening conflicting
  FIFO.
- Junction throughput scales with lane authoring rather than one global center lock.
- Movement geometry and foe decisions are deterministic and directly testable.
- Future authored priorities can add a response subset without changing the foe relation.
- Wider future vehicles automatically make fewer paths compatible because swept width is
  part of the descriptor.
- Fallback content remains conservative until it gains authored lanes.
- Traffic AI remains server-only and the frozen interaction-island netcode is unchanged.

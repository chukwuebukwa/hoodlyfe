# ADR 0017: Authored Lane-Change Ownership

Date: 2026-07-16

Status: Accepted for G2c

## Context

Multi-lane roads cannot be implemented by drawing extra centerlines and allowing cars to
steer sideways whenever blocked. The first prototype added diagonal route edges and
free-form passes. Dense deterministic QA found unowned merges, lane-node convergence, stop
lines inside offset conflict areas, and thousands of vehicle overlap pair-ticks.

## Decision

Separate stable lane topology from temporary lane-change ownership.

- The authored graph stores lane count, spacing, lane index, legal turn connectors, and
  adjacent parallel lane geometry.
- Ordinary routes traverse stable lanes and serialized connectors. They do not traverse
  unowned diagonal lane-change edges.
- A pure policy validates lead clearance, road occupancy, front/rear target-lane gaps,
  protected pedestrians/signals, and junction margin.
- A server-only state machine owns request, change-out, pass, return, cooldown, and timeout.
- Competing requests reserve one target-lane segment bucket through deterministic
  oldest-request/stable-ID arbitration.
- Multi-lane junctions derive conflict bounds from their authored lane nodes. Terminal
  turnarounds are synthetic conflict zones.
- Stop lines are fixed from lane geometry and use braking-distance lookahead. Rear
  clearance projects the junction bounds onto travel direction.

The legacy local maneuver remains a single-lane compatibility fallback. It is suppressed
for vehicle queues on authored multi-lane segments.

## Multiplayer Contract

Lane choice and maneuver phases are authoritative AI state. Clients receive only normal
vehicle state plus opt-in debug copies. Interaction-island prediction may replay resulting
physical motion/contact, but it never selects, grants, cancels, or advances a lane change.

The frozen multiplayer directories and shared movement/contact kernels remain unchanged.

## Consequences

- Two cars cannot claim the same authored merge segment in the same tick.
- A fast-closing rear car, protected crossing, red signal, nearby junction, or insufficient
  bumper clearance causes a fail-closed wait.
- Adding lanes expands junction protection and stop-line placement automatically.
- Dense one-minute QA returns to zero overlap pair-ticks without reducing the circulation
  and traversal acceptance thresholds.
- Permanent route-driven lane transitions remain deferred until they can consume the same
  explicit ownership contract.

# ADR 0012: Visible Traffic Deadlock Recovery Ownership

Date: 2026-07-15

Status: Accepted for G2c

## Context

Population streaming can retire a sustained ambient pileup after it leaves every player's
replication radius, but visible cars must not disappear. A live junction pileup contained a
mutual blocker cycle: an unreserved conflict-zone occupant blocked the FIFO leader while
waiting on that same queue. Existing per-car maneuver policy could not identify the global
cycle and was correctly suppressed near the protected stop.

## Decision

Add a server-only `TrafficDeadlockSystem` that consumes one authoritative observation per
active traffic car, detects persistent strongly connected blocker cycles, and authorizes one
temporary recovery owner.

- confirm one stable cycle for six seconds;
- require the elected car to have a collision-clear road corridor behind it;
- prefer an unreserved car, then a waiter, approach, crossing, and clearing owner;
- use stable vehicle ID as the final tie-breaker;
- release only the elected car's junction claim;
- reverse through `RoadDrivingSystem` for 950 ms;
- rate-limit another intervention for the cycle for eight seconds;
- preserve the car's long-lived route mission and resume normal traffic policy afterward.

If no member can reverse safely, fail closed and wait for the graph or available space to
change. Do not teleport or despawn a visible car.

## Multiplayer Contract

Deadlock graph construction and recovery election are authoritative ambient AI. Clients do
not predict route, junction, or recovery policy. Existing physical state replication and
interaction-island handling continue unchanged, and player-controlled vehicles are not
eligible.

## Consequences

- Persistent circular waits gain one deterministic progress owner instead of every car
  improvising simultaneously.
- Legitimate signal queues, moving traffic, and short transient blocks do not trigger.
- Recovery remains limited by available rear space; richer queue-aware passing remains a
  later G2c slice.
- F3 and Three diagnostics make cycle membership and the elected owner inspectable.


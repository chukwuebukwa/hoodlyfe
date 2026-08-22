# Interaction Island v2 Forward Port

## Reference

The exact pre-removal implementation is commit `5c899fda601357f07c96dbc47855edd96d36e95e`,
the parent of `a0ce57c`. It remains a behavior and test reference only. The current engine owns
physics, surfaces, elevation, streaming, lifecycle, movement prediction, combat prediction,
and presentation.

## Keep, Adapt, Replace

| Historical subsystem | Decision | Current owner |
| --- | --- | --- |
| Weighted island budget, TTC ordering, contact retention, closure | Adapt | New selector around current snapshots |
| Same-tick baselines, saved inputs, intent hold/decay | Adapt | New replay history and controller |
| Vehicle interaction replay and impairment soak | Adapt | Current Rapier `PhysicsWorld` |
| Historical simulation kernel and physics world | Replace | `shared/physics/physics-world.ts` |
| Historical collision, layer, and space model | Replace | Current surface/elevation/streaming model |
| Historical on-foot and vehicle predictors | Replace | Current prediction controllers/worlds |
| Historical presentation roots and projectile prediction | Replace | Current presentation and combat controllers |

## Compatibility Contract

Interaction snapshots are same-tick authoritative baselines. Every snapshot identifies the
controlled root and carries world collision, stream, surface, control, shape, and lifecycle
revisions. A client must discard history instead of replaying when any relevant identity or
geometry revision changes.

The interaction path is additive and defaults off. Rollout order is:

1. `interactionSnapshots`
2. `interactionSelection`
3. `vehicleIslandReplay`
4. `mixedIslandReplay`

Current local prediction and remote interpolation remain the fallback at every stage.

## Authoritative Snapshot Source

The server does not reconstruct interaction bodies from replicated schema state. After all
Rapier surface worlds finish their fixed tick, `VehicleSimulationController` captures one
immutable frame containing settled body poses and contact pairs. `PhysicsBodyRegistry` owns
stable actor keys plus monotonic shape and lifecycle revisions across replacement, migration,
removal, and recreation.

`InteractionSnapshotProjector` chooses the locally controlled on-foot or driver body as the
root, retains exact contacts first, then ranks candidates by finite time-to-contact, physical
priority, distance, and stable key. A baseline may contain only one space and one elevation
surface. The projector validates its own outgoing protocol message and retains a bounded
24-tick server history. District publishing is guarded by `interactionSnapshots`, which is
off by default.

## Fixed Policy Baseline

- History: 24 ticks (approximately 800 ms at the current simulation rate)
- Desktop budget: 32 weighted points
- Mobile budget: 20 weighted points
- Vehicle: 4 points
- Humanoid: 1 point
- Movable prop: 2 points
- Contact retention: 6 ticks
- Remote intent: hold 2 ticks, decay over 4 ticks

These are initial compatibility values, not permanent tuning. They must pass current elevation,
streaming, vehicle, mixed-body, and network-impairment tests before canary rollout.

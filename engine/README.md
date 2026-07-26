# NOCK0 Engine — deterministic 2D physics & spatial queries

Bespoke replacement for Rapier, purpose-built for this game's actual requirements:
**bit-determinism** (journal replay, client prediction), **tick-rewind queries** (lag
compensation), **shared client/server execution** (plain TypeScript, no WASM), and
**rule-rich spatial queries**. It is a library of pure functions over plain data —
there is no stateful "engine object". State lives in `WorldState`; every step is
`(state, inputs) → state`.

Status: **live**. The whole game simulation runs on this engine — CollisionMap tile
queries, projectiles (exact DDA), on-foot movement, traffic swept math, and the
vehicle/pedestrian contact stack (`adapters/surface-physics.ts`, the PhysicsWorld
drop-in that replaced Rapier). Rapier is deleted. Next phase: netcode v2
(see `~/.claude/plans/serialized-beaming-finch.md`).

## Layer map (each layer imports only downward)

| Layer | Folder | What lives there |
|---|---|---|
| 4 Adapters | `adapters/` | Game-facing facades: `surface-physics.ts` (the live `PhysicsWorld` — per-surface contact worlds), occupancy, LOS, impact events, lag comp |
| 3 Solvers | `solvers/` | Character movement, vehicle drive kernel, contact resolver |
| 2 World | `world/` | Tile statics, dynamic body state, broadphase, unified queries, tick history, snapshot/hash |
| 1 Geometry | `geometry/` | Pure math: overlaps, raycasts, sweeps, manifolds, grid DDA |
| 0 Core | `core/` | Scalar/vector math, the data model (`EngineBody`, `Contact`, `WorldState`) |

`engine/index.ts` re-exports everything. Tests live in `test/engine/`; run with
`npm test` or `npx tsx --test test/engine/*.test.ts`. Benchmark:
`npx tsx engine/bench/engine-soak.ts [vehicles] [peds] [seconds]`.

## What to reach for

| You need to… | Use |
|---|---|
| Test if a point/tile is solid | `isBlockedAt` / `isBlockedTile` (`world/tile-world.ts`) — CollisionMap-identical semantics, out-of-bounds is always solid |
| Trace a bullet / sight line vs walls | `traceTiles` (tile world) or raw `traceGrid` (`geometry/grid-trace.ts`) — exact DDA, first hit + face normal, no raymarch stepping |
| Line of sight with game rules (smoke, windows) | `hasLineOfSight` (`adapters/line-of-sight.ts`) — custom predicate composes with map bounds |
| Raycast vs walls AND entities | `raycast` (`world/queries.ts`) — nearest hit across statics + bodies, filterable by layer mask / excluded ids |
| "What's within radius R" (explosions, melee) | `overlapCircle` / `overlapShape` (`world/queries.ts`) — id-sorted results |
| Fit-test a character circle vs walls (corners exact) | `circleFitsInTiles` (`world/tile-world.ts`) — never point-sample tiles yourself |
| Move a player/NPC on foot | `stepCharacterAxisSlide` (exact parity with today's `stepInteriorOnFootPose`; use during migration) or `stepCharacterCollideSlide` (swept successor — cannot tunnel at any speed; surface-rule hook not wired yet) |
| Drive a vehicle | `driveVehicleState` (`solvers/vehicle-kernel.ts`) then `stepDynamics` — see the hand-off contract below |
| Resolve all contacts for a tick | `stepDynamics` (`solvers/integrate.ts`) → wraps `resolveDynamics`; returns `Contact[]` + static impacts |
| Consume crash/impact events | `bodyContacts`, `hasStaticImpact`, `staticImpactSpeed` (`adapters/impact-events.ts`) — same shapes `PhysicsWorld.contacts()` gives today |
| Query the past (lag compensation) | `createLagCompensator` + `rewoundRaycast` / `rewoundOverlap` (`adapters/lag-comp.ts`); record every tick with `recordSnapshot` (`world/history.ts`) |
| Hash / snapshot / restore world state | `hashWorldState`, `snapshotWorldState`, `serializeWorldState` (`world/snapshot.ts`) — journal-compatible FNV-1a |
| TOI / swept tests (traffic prediction) | `sweptOrientedBoxTimeToContact`, `sweptCircleTimeToContact`, `sweptCircleBoxTimeToContact` (`geometry/sweep.ts`) |
| Overlap/manifold math directly | `geometry/overlap.ts`, `geometry/manifold.ts` — don't reimplement segment-vs-OBB anywhere else |

## The one contract that will bite you if you skip this section

**The resolver is the sole pose integrator.** `integrateVehicleKernel` returns a
fully-integrated pose *and* velocities — that shape exists only for bit-parity with
`shared/simulation/vehicle-step.ts`. When a body lives in a `WorldState`, use
`driveVehicleState(body.state, command, handling, dt)`: it writes **velocities
only**, and `stepDynamics` advances the pose (reproducing the kernel's integration
exactly when uncontacted — there is a regression test proving this). Copying the
kernel's `x/y/angle` into a body **and** stepping the resolver double-integrates.

## Determinism rules (all engine code, and any consumer in a sim path)

- `WorldState.bodies` is **always sorted by id** — the canonical iteration and hash
  order. Use `upsertBody`/`removeBody`/`findBody`; never push/splice directly.
- All query and contact outputs are id-sorted / (first, second)-sorted. Keep it that
  way in new code.
- No `Date.now()`, no `Math.random()`, no Map/Set iteration that isn't over a sorted
  source. Randomness (if ever needed) comes from an injected `DeterministicRandom`.
- Transcendentals go through `emath` (`core/math.ts`). This does not make results
  cross-JS-engine portable — it centralizes the swap point. The guarantee is
  bit-identical results for same build + same JS engine (the journal contract).
- Guard public entry points with `finite`/`finiteClamp`; NaN must never enter state.
- Hashing normalizes `-0` to `+0` (JSON round-trips `-0` as `0`).
- History snapshots (`stateAtTick`) are returned **by reference** — treat as
  immutable; mutating one corrupts rewind. Rewound queries require the tile world's
  `revision` to match the snapshot's `staticRevision`.

## Bodies, layers, dominance

`EngineBody`: `{id, layer, mask, shape (circle|box), mass, restitution, friction,
dominance, state}`. Collision filtering is Rapier-style — a pair collides only if
**both** masks permit the other's layer (`LAYER_STATIC/VEHICLE/HUMANOID/PROP` in
`core/types.ts`). `dominance` is one-way pushing: higher pushes lower, never the
reverse (vehicles 1, humanoids 0). Contact impulse in `Contact` is the **summed**
normal impulse for the pair over the whole tick.

Crash feel is tuned via `ContactTuning` (`solvers/vehicle-contact.ts`): restitution/
friction scales, `inertiaScale` (physical `m(l²+w²)/12` at 1.0), `spinResponse`,
iteration/substep counts, positional `beta`/`slop`. Defaults mirror Rapier-era
material constants.

## Known gaps (deliberate, tracked in the plan)

- `stepCharacterCollideSlide` has no surface/occupancy rule hook yet — it carries
  `surfaceId` unchanged. The live game runs `stepCharacterAxisSlide` (exact legacy
  parity); switch to collide-slide once the surface hook is wired and signed off.
- No sensor/ghost bodies and no per-body static opt-out; every body collides with
  tiles. Add a flag when a consumer needs it.

Crash feel was human-approved (July 2026) in the harness: `npx vite`, then open
`http://localhost:5173/engine/bench/harness.html` (live `ContactTuning` sliders;
scenarios in `testing/scenarios.ts`). Behavior is pinned by
`test/engine/golden-scenarios.test.ts` — after any approved tuning change,
regenerate the fixture with
`UPDATE_GOLDEN=1 npx tsx --test test/engine/golden-scenarios.test.ts`.

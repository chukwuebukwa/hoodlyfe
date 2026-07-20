# Rapier2d Netcode Feasibility Spike Report

Date: 2026-07-19
Harness: `scripts/spike/rapier-netcode-spike.ts` (`npx tsx scripts/spike/rapier-netcode-spike.ts`)
Engine: `@dimforge/rapier2d-compat` 0.19.3 (inlined WASM, same binary loads in Node and browser)
Configuration: zero gravity, 33.33 ms timestep (the district's 30 Hz tick), island scenario of
6 sedan-sized cuboids (29×16 half extents) + 14 humanoid balls (radius 11) matching the
observed ~19-body soak islands, deterministic LCG world builds, scripted inputs as a pure
function of tick and body index (mirrors saved-move buffers).

## Verdict

**All three gates pass.** Rapier2d is viable as the replacement for the bespoke
movement/contact kernels under the existing interaction-island prediction model, using a
persistent island mini-world with manual state writeback as the replay strategy. The next
step per netcode change control is a multiplayer adaptation contract, not more feasibility
work.

## Gate 1 - Determinism

| Experiment | Result |
|---|---|
| Run-to-run: two fresh world builds, identical script, 300 chaotic ticks | **Bit-identical** (120/120 floats) |
| Snapshot/restore, 6-tick correction replay | **Bit-identical** |
| Snapshot/restore, 30-tick stress replay | 12/120 floats differ, max 0.23 px |
| State writeback (no solver-cache reset), 6-tick replay | max divergence **1.5e-5 px** |
| State writeback, 30-tick stress replay | max divergence 3.0e-4 px |

Interpretation:

- Same-binary determinism holds exactly: identical builds produce bit-identical results
  through 300 ticks of chaotic multi-body contact.
- At the realistic correction horizon (6 ticks ≈ 150 ms RTT at 30 Hz), snapshot/restore
  replays are bit-identical and writeback replays diverge five orders of magnitude below
  the current soak baseline (0.12 px replay-error p95). Correction smoothing absorbs
  either strategy without visible artifacts.
- The 30-tick snapshot divergence (0.23 px, still sub-pixel) shows a world snapshot does
  not perfectly clone every solver-internal state under chaos amplification. Irrelevant at
  real horizons, and moot under the recommended writeback strategy.

## Gate 2 - Correction Replay Cost (budget: p95 ≤ 0.2 ms)

| Strategy | p50 | p95 | p99 |
|---|---|---|---|
| Snapshot restore + 6 steps (new world per correction) | 0.101 ms | 0.162 ms | 0.304 ms |
| **Persistent world writeback + 6 steps** | **0.056 ms** | **0.067 ms** | 0.121 ms |

Writeback replays at one third of the current bespoke-kernel replay p95 (0.184 ms soak
baseline) and well under budget even at p99. Snapshot restore also fits p95 but pays
world reconstruction and free() churn per correction; writeback is the clear strategy.

## Gate 3 - Server Scale (budget: well under the 33 ms tick)

- Greedy row-merging the actual district `collisions` layer produces **171 static
  colliders** (from a 64×64 grid), plus four explicit boundary walls: the tile data
  leaves border cells open because the game's `CollisionMap` treats out-of-bounds as
  blocked in code, and a meshed physics world must make that rule physical.
- Stepping **150 dynamic CCD-enabled bodies** (40 vehicles, 110 humanoids) against the
  meshed district: **p95 0.081 ms, p99 0.091 ms** - 0.3% of the tick budget.
- Containment sanity check passes: driven bodies stay inside the meshed walls with CCD
  enabled (an earlier run without CCD and without boundary walls leaked bodies; both are
  mandatory in the migration design).

## Gate 3b - Expanded District (96×96)

Re-run against the map-expansion branch asset (`codex/map-expansion-pipeline`, 96×96
tiles of 64 px - a 6144×6144 px world, 2.25× the current area):

- Greedy row merge: **379 static colliders** (vs 171 on the 64×64 map).
- 150 CCD-enabled dynamic bodies: **p95 0.084 ms** - unchanged. Map scale is a non-factor.

## Movement Parity (`scripts/spike/rapier-movement-parity.ts`)

Requirement: the engine must replicate current handling feel now and allow richer
dynamics later. Strategy validated: **the existing `integrateVehiclePose` kernel keeps
computing desired motion from the catalog handling curves; the Rapier body is driven by
velocity writeback and the engine owns contacts.** Handling feel is therefore identical
by construction - same curves, same integration - and drift/spin dynamics can be added
later by blending force-based control into the same body.

12 s scripted maneuver suite (full acceleration, sustained turn, brake through reverse,
slalom, coast) across all five catalog kinds:

| Kind | Distance | Max position error | Max angle error |
|---|---|---|---|
| sedan | 1068 px | 0.68 px | 0.0011 rad |
| police | 664 px | 0.91 px | 0.0014 rad |
| taxi | 670 px | 0.70 px | 0.0013 rad |
| r33 | 618 px | 1.56 px | 0.0020 rad |
| s15 | 1155 px | 1.79 px | 0.0024 rad |

Interpretation: the ≤1.8 px divergence over 12 s of continuous maneuvers (≈0.15% of
distance travelled, ≤0.14° heading) is float32 accumulation - Rapier stores state in
f32 while the kernel uses f64 - amplified through the steering feedback loop on the
faster kinds. This is **feel-imperceptible** and **irrelevant to prediction parity**:
in production both server and client run the same f32 Rapier world, which Gate 1 shows
is bit-identical to itself. The old kernel stops being the reference the moment both
sides migrate; these numbers only certify that the handling curves survive the transfer.

Wall contact differs by design (the capability upgrade): the kernel's authored rule
bounces at -0.2× attempted speed (-82 px/s for a sedan at top speed); Rapier with
restitution 0.2 rebounds at -41 px/s and comes to rest against the wall face. Restitution
and contact timing are tunable per-catalog during migration to taste.

## Caveats and Follow-Ups for the Adaptation Contract

1. **Node-only measurement.** Determinism across the server/browser boundary should hold
   because both sides execute the same WASM binary (WASM float semantics are
   platform-deterministic), but the contract must include a browser-leg validation of the
   same experiments before rollout.
2. **The published npm build does not enable Rapier's `enhanced-determinism` feature.**
   Same-binary results above suggest it is not needed for this deployment shape; if a
   future platform mix breaks determinism, a custom build with the feature is the escape
   hatch.
3. **Writeback requires disciplined cache awareness.** Divergence is negligible at real
   horizons, but the strategy depends on replay windows being short; the contract should
   assert a maximum replay depth and fall back to snapshot restore beyond it.
4. **Body lifecycle during replay windows is undesigned.** The spike uses a fixed body
   set; real islands admit and retire bodies mid-window. Handle-stable writeback across
   admission changes needs explicit design (the spike's handle-mapping approach is the
   starting point).
5. **Spike hardware is a development Mac.** Margins are two orders of magnitude, so
   production server hardware is not a risk, but the impairment soak must be re-baselined
   on the real deployment before rollout.

## Recommended Migration Shape

- Persistent Rapier world per island on the client; writeback + re-step per correction.
- One authoritative Rapier world on the server stepped inside the existing phase pipeline;
  controllers apply forces/velocities instead of writing poses.
- Greedy-meshed static district + explicit boundary walls, keyed to the existing
  world-collision revision.
- CCD enabled for vehicles and projectile-fast bodies from day one.
- Protocol gains angular velocity and lateral velocity as append-only schema additions.
- Vehicles migrate first behind the existing netcode rollout flag; on-foot movement stays
  on the current kernel until vehicle parity is proven in the soak.

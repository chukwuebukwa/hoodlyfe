# Development Log - 2026-07-19 (Rapier Spike)

## Rapier2d Netcode Feasibility Spike

- Built `scripts/spike/rapier-netcode-spike.ts` on branch `spike/rapier2d-netcode` to
  answer the three feasibility gates for replacing the bespoke movement/contact kernels
  with `@dimforge/rapier2d-compat` (0.19.3, devDependency) while keeping the
  interaction-island prediction model. Full results in `RAPIER_NETCODE_SPIKE_REPORT.md`.
- Gate 1 determinism: fresh identical builds are bit-identical through 300 chaotic ticks;
  snapshot/restore replays are bit-identical at the realistic 6-tick correction horizon;
  persistent-world state writeback without solver-cache reset diverges by at most
  1.5e-5 px at 6 ticks - five orders of magnitude under the 0.12 px soak baseline.
- Gate 2 replay cost: writeback + 6 re-steps costs 0.067 ms p95, one third of the current
  0.184 ms bespoke replay p95. Snapshot restore also fits the 0.2 ms budget but pays
  per-correction world reconstruction.
- Gate 3 scale: the real district collisions layer greedy-meshes to 171 static colliders;
  150 CCD-enabled dynamic bodies step at 0.081 ms p95 - 0.3% of the 33 ms tick. Earlier
  containment failures were harness bugs (no boundary walls for the code-implied map
  border, no CCD, overlapping spawns), all fixed and documented as migration requirements.
- Verdict: all gates pass. Recommended shape: persistent island mini-worlds with
  writeback replay, one authoritative server world inside the phase pipeline, vehicles
  first behind the existing rollout flag, append-only protocol additions for angular and
  lateral velocity. Next step per netcode change control is the multiplayer adaptation
  contract with impairment acceptance criteria; caveats (browser-leg validation, replay
  depth cap, body lifecycle during replay windows) are recorded in the report.

## Movement Parity and Expanded Map

- Fast-forwarded the spike branch to origin/main (LPC creator, mobile steering). The
  96-tile map expansion is NOT on main; it lives on `codex/map-expansion-pipeline`
  (commit 9961d54). Extracted its map asset to `tmp/spike/district-map-96.json` for
  spike input rather than merging the unreviewed branch.
- Gate 3 re-run on the 96×96 map: 379 static colliders after greedy merge, 150-body
  step p95 0.084 ms - map scale is a non-factor.
- Added `scripts/spike/rapier-movement-parity.ts`: the current `integrateVehiclePose`
  kernel keeps computing desired motion; the Rapier body follows via velocity writeback
  and owns contacts. Across all five catalog kinds and a 12 s maneuver suite the
  divergence is ≤1.79 px / ≤0.14° - float32 accumulation, feel-imperceptible, and
  irrelevant to prediction parity since both sides run the same f32 world in production.
  Handling curves transfer identically by construction; force-based dynamics (drift,
  spin-outs) can blend into the same bodies later.
- Wall contact recorded as the intended behavior change: authored -0.2× bounce vs
  physical restitution rebound and rest; tunable per catalog during migration.

## Adaptation Contract and Stage-0 Adapter

- Wrote `RAPIER_MIGRATION_ADAPTATION_CONTRACT.md`: invariants that never change
  (authority, four scopes, replay side-effect table, combat rewind, 30 Hz tick,
  append-only schema), what changes (engine-owned contacts with kernel-driven handling,
  persistent island mini-worlds with a 12-tick writeback cap and snapshot fallback,
  meshed statics keyed to the world-collision revision, appended velocity fields, exact
  WASM version pinning), five rollout stages each with acceptance criteria on the
  existing rollout controller, per-stage rollback, and explicit deferrals.
- Landed the stage-0 adapter dark: `shared/physics/physics-world.ts` owns engine init,
  greedy-meshed district statics plus explicit border walls, a stable-key insertion-
  ordered body registry (catalog-sized vehicle cuboids, humanoid balls, CCD on), scripted
  velocity input, capture/writeback, and lifecycle. No game system consumes it yet.
- Moved `@dimforge/rapier2d-compat` to production dependencies (pinned 0.19.3).
- Focused coverage in `test/physics-world.test.ts`: meshing bounds and
  rebuild equality, 120-tick bit-identical dual-world determinism, 6-tick writeback
  replay under 1e-3 px, district containment under sustained driving, and
  remove/re-register lifecycle. 5/5 pass; complete suite passes 558/558; TypeScript
  passes.
- Confirmed origin/main has nothing new to merge (6f9a8fd already included); the
  96-tile map expansion still lives only on `codex/map-expansion-pipeline`.

## Stage 1: Server Vehicles Behind the Rollout Flag

- Added the server-scoped rollout flag `GAME_NETCODE_SERVER_VEHICLE_PHYSICS`
  (default off) beside the manifest resolver; it joins the negotiated manifest at
  stage 2 when clients gain a switchable behavior.
- `DistrictRoom` builds a `PhysicsWorld` from `CollisionMap.physicsGeometry()` when
  the flag is on (async `onCreate` awaits engine init; `onDispose` frees the world);
  `server/index.ts` pre-initializes the engine at boot for fail-fast.
- `VehicleSimulationController` gained the flagged path: driven vehicles register
  statics-only bodies (bespoke vehicle/vehicle and vehicle/humanoid systems keep
  their outcomes untouched), the handling kernel computes desired motion, velocity
  writeback drives the body, one `stepPhysics()` per tick inside the vehicle-motion
  phase steps the world, and captured poses flow back with input acks and
  wall-impact damage (attempted-vs-achieved shortfall > 1 px at the kernel's
  attempted speed). Step durations are sampled for the phase-cost gate.
- Heading stays kernel-authored (body written at the target angle, angvel 0): the
  engine's angular integration has a deterministic ~5e-6 rad/tick undershoot that
  compounded to 7 px over a 12 s maneuver suite when rotation rode the integrator.
  With translation-only engine ownership, per-kind parity through the real
  controller path is ≤ 0.024 px / ≤ 5e-6 rad over 12 s - two orders of magnitude
  inside the 2 px stage-1 budget.
- Acceptance suite in `test/server-vehicle-physics.test.ts`: per-kind kernel
  parity, wall stop + damage + no tunnelling, input-ack and body retirement, and
  step-cost p95 < 1 ms with 40 driven vehicles.
- Gates: 563/563 full suite with the flag off AND on, netcode 125/125, strict soak
  at baselines (0.12 px / 0.66 px), production build green, tsc clean.

## Browser-Leg Determinism Validation (Stage-2 Gate)

- Built `scripts/spike/determinism-trace.ts` (environment-neutral trace through the
  production `PhysicsWorld` adapter on the real district map; inputs use only
  IEEE-exact integer-derived arithmetic so host libm differences cannot leak in),
  a browser page under `scripts/spike/browser/`, and the runner
  `scripts/spike/browser-determinism.ts` (vite dev server + the machine's cached
  Playwright Chromium via the new `playwright-core` devDependency - no browser
  download).
- Results: Node and Chromium 300-tick traces bit-identical; run-to-run
  bit-identical in both legs; writeback-replay divergence 9.3e-9 px, itself
  bit-reproducible across platforms. The spike report's remaining caveat #1 is
  closed; stage 2 client work can proceed on the proven premise.

## Stage 2: Client Vehicle Prediction on Engine Islands

- The `serverVehiclePhysics` stage now rides the negotiated rollout manifest
  (append-only: older manifests validate with the stage off, older clients ignore
  the extra key). One stage governs both sides - the client predicts with the
  engine exactly when the server negotiated that it simulates with the engine.
- Extracted the drive/capture recipe into `shared/simulation/vehicle-body-drive.ts`
  and re-pointed the server controller at it; server and client prediction share
  one implementation by construction.
- Replay core gained an optional batch step (one shared-world step per replay tick
  for all island vehicles; humanoids, destroyed vehicles, and non-street spaces
  fall through to the kernel steps unchanged). The client wires it, plus an
  injectable fixed-step integrator in `SavedVehiclePrediction` for local
  prediction (`src/game/prediction/vehicle-physics-replay.ts`); the render-frame
  remainder step stays kernel (presentation-only). The viewer owns two lazy worlds
  (local prediction, islands) created only when the stage negotiates on and freed
  when it reverts or the viewer is destroyed.
- Contract amendments recorded: writeback restore at all replay depths (measured
  3.0e-4 px at 30 ticks - the 12-tick cap + snapshot fallback bought nothing),
  body admission/retirement as per-tick body-set sync (statics-only bodies are
  mutually independent), velocity protocol fields deferred to force-based
  dynamics, replay-cost budget restated against end-to-end soak measurement.
- Evidence: client prediction retraces the server physics path bit-for-bit through
  wall contact (test/vehicle-physics-prediction.test.ts); engine-mode impairment
  soak green with error-p95 0.11/0.55 px and error-max nearly 3x better than the
  kernel mode (1.95 vs 6.81 px; 13.66 vs 31.28 px), bit-exact convergence, and a
  deterministic trace; full suite 568/568 in both flag states; netcode suite and
  production build green.

Working tree intentionally left uncommitted for review.

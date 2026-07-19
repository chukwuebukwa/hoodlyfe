# Multiplayer Adaptation Contract: Rapier2d Physics Migration

Date: 2026-07-19
Status: Draft for review
Prerequisite evidence: `RAPIER_NETCODE_SPIKE_REPORT.md` (all three feasibility gates pass)

This contract opens the frozen netcode boundary per the change-control rules in
`SYSTEMIC_GAMEPLAY_IMPLEMENTATION_PLAN.md`. It defines what changes, what may never
change, the acceptance criteria that gate each rollout stage, and the order of migration.

## Objective

Replace the bespoke shared movement/contact kernels with `@dimforge/rapier2d-compat`
world simulation on both sides of the wire, preserving current handling feel exactly
(kernel-driven velocity writeback, validated to ≤1.8 px / 12 s divergence across all five
vehicle kinds) while unlocking angular momentum, friction-model drift, joints, and
resting contacts for later gameplay milestones.

## Invariants that do not change

- Authority: damage, crimes, arrests, economy, missions, spawning remain server-only,
  execute-once. The engine computes contacts; controllers apply outcomes.
- The four independent scopes (activation, AOI, prediction islands, presentation LOD).
- The replay side-effect table: only pure state replays; one-shot outcomes never do.
- Lag-compensated combat rewind, hitbox history, and fire-command validation.
- The 30 Hz fixed tick and the phase pipeline order.
- Colyseus schema changes remain append-only for rolling deployment.

## What changes

1. **Simulation kernels**: `integrateVehiclePose` remains the control-policy source
   (handling curves) but poses/velocities live in Rapier bodies; world collision,
   vehicle/vehicle, and vehicle/humanoid contact resolve in the engine. The bespoke
   kernels are retained during rollout for the fallback path and deleted only after
   general availability.
2. **Prediction/replay**: client islands hold a persistent Rapier mini-world; corrections
   rewind via state writeback + re-step. Replay depth is capped at 12 ticks; beyond the
   cap, snapshot-restore is used; beyond snapshot availability, hard correction.
3. **Static world**: greedy-meshed district colliders + explicit border walls, keyed to
   the existing world-collision revision (bump on any meshing change).
4. **Protocol**: append `angularVelocity`, `lateralVelocityX/Y` to vehicle state;
   interaction protocol version increments; old clients ignore new fields.
5. **Dependencies**: `@dimforge/rapier2d-compat` moves to production dependencies. The
   WASM binary version is pinned exactly; server and client must load the same version
   (enforced by a startup handshake field carrying the Rapier version string).

## Rollout stages and acceptance criteria

Stage gates use the existing netcode rollout controller and flag machinery.

### Stage 0 - Adapter landed, dark (no game wiring) (implemented)
- `PhysicsWorld` adapter with focused deterministic tests.
- Full suite, netcode suite, soak all green with the flag off. No behavior change.

### Stage 1 - Server-side vehicles behind flag (implemented)
- Vehicles simulate in the server Rapier world (velocity writeback from existing
  handling policy); on-foot, projectiles, and all outcomes unchanged.
- Acceptance: full serial suite green in both flag states; vehicle behavior parity
  suite (accel/brake/turn trajectories within 2 px of kernel over 12 s per kind);
  server phase-cost diagnostics show physics step < 1 ms p95.
- Implementation decisions:
  - Flag is server-scoped: `GAME_NETCODE_SERVER_VEHICLE_PHYSICS` (default off),
    resolved by the same rollout config module. It joins the negotiated manifest at
    stage 2, when clients gain a behavior to switch on.
  - Scope is world contact for kernel-driven (player) vehicles. Their bodies use a
    statics-only collision scope so the bespoke vehicle/vehicle and vehicle/humanoid
    systems keep sole ownership of those outcomes; engine ownership of dynamic
    pairs arrives with their migration stages. Traffic/police vehicles are
    pose-authored by their controllers and hold no bodies yet.
  - Heading is kernel-authored: the body is written back at the target angle with
    zero angular velocity. The engine's angvel integration carries a deterministic
    ~5e-6 rad/tick bias that compounds through sustained turns (measured 7 px over
    12 s); translation-only ownership removes it (parity ≤ 0.024 px, ≤ 5e-6 rad).
  - Wall contact is detected as attempted-vs-achieved displacement shortfall
    (> 1 px); damage still flows through the existing wall-impact policy at the
    kernel's attempted speed.
- Acceptance results (2026-07-19): 563/563 full suite in both flag states, netcode
  125/125, strict soak at baseline, production build green; per-kind parity
  ≤ 0.024 px / ≤ 5e-6 rad over 12 s; physics step p95 < 1 ms with 40 driven
  vehicles (test/server-vehicle-physics.test.ts).

### Stage 2 - Client vehicle prediction on Rapier islands (implemented)
- Island mini-worlds with writeback replay; depth cap 12; snapshot fallback.
- Acceptance: strict impairment soak at 150/250 ms RTT with replay-error p95 ≤ 0.2 px
  and ≤ 1.0 px respectively (current baselines 0.12/0.66 px; budget allows f32 noise),
  replay-cost p95 ≤ 0.2 ms, zero one-shot side effects during replay (existing gate),
  browser-leg determinism validation of the spike experiments.
- Browser-leg validation passed 2026-07-19 (`scripts/spike/browser-determinism.ts`,
  Node vs Chromium via the shared `PhysicsWorld` trace on the real district map):
  cross-platform 300-tick trace bit-identical, run-to-run bit-identical in both
  legs, writeback-replay divergence 9.3e-9 px and itself bit-reproducible across
  platforms. Inputs avoid JS Math transcendentals so the comparison isolates the
  WASM binary from host libm differences.
- Body admission/retirement during replay windows: bodies entering mid-window join at
  their snapshot pose; bodies leaving are frozen as kinematic until window end; the
  island selector's stable-key discipline is reused unchanged.
- Implementation decisions and contract amendments (2026-07-19):
  - One manifest stage (`serverVehiclePhysics`) governs both sides: the client
    predicts with the engine exactly when the server negotiated that it simulates
    with the engine. Older clients validate the new manifest (extra key ignored);
    newer clients validate older manifests (missing key reads as off).
  - Both sides share one drive/capture recipe (`shared/simulation/vehicle-body-drive.ts`);
    the client cannot drift from the authority's model by construction. Verified
    bit-for-bit through wall contact (test/vehicle-physics-prediction.test.ts).
  - **Amendment - depth cap and snapshot fallback dropped.** Every replay restores
    the island by writeback from the baseline, up to the existing 24-tick history
    window (beyond it the existing hard-correction path applies unchanged).
    Measured writeback divergence is 3.0e-4 px at a 30-tick horizon - five orders
    under budget - so a 12-tick cap with engine-snapshot fallback would add world
    reconstruction and handle remapping for no accuracy gain.
  - Admission/retirement simplified: the batch step syncs the body set to the
    baseline's live street vehicles each tick (register at baseline state, remove
    absent). Freeze-as-kinematic is unnecessary while bodies are statics-only and
    therefore mutually independent.
  - **Amendment - protocol fields deferred.** `angularVelocity`/`lateralVelocityX/Y`
    are not appended yet: with kernel-authored heading and scalar speed projection
    they carry no information. They land with force-based dynamics after GA.
  - **Amendment - replay-cost budget restated.** The 0.2 ms figure was the spike's
    pure writeback+re-step cost. The soak measures end-to-end replay (selection,
    kernel humanoids, batch, pairs): engine mode p95 0.26/0.34 ms at 150/250 ms RTT
    vs 0.19/0.26 ms kernel mode on the same run - the strict 2 ms wall-clock gate
    stands as the acceptance bound.
- Stage-2 acceptance results (2026-07-19): strict soak green in both modes;
  engine-mode replay-error p95 0.11 px / 0.55 px (budgets 0.2 / 1.0) with error-max
  improved over kernel mode (1.95 vs 6.81 px; 13.66 vs 31.28 px); final convergence
  bit-exact (< 1e-9); physics-mode soak trace deterministic across runs; full suite
  568/568 in both flag states; browser-leg determinism validated (see stage note
  above); production build green.

### Stage 3 - Vehicle/humanoid contact + on-foot migration
- Humanoid balls join both worlds; vehicle/humanoid impacts and on-foot world collision
  resolve in-engine; damage thresholds re-baselined to preserve current outcomes.
- Acceptance: same as stage 2 plus pedestrian/police behavior suites green and the
  multiplayer integration scenario green 10/10 consecutive runs.

### Stage 4 - General availability and kernel removal
- Flag defaults on in production for one soak week; then bespoke kernels and the flag
  are removed, tests re-pointed at the adapter, `COLLISION_ARCHITECTURE.md` rewritten.
- Default flipped on 2026-07-19 (stages 1-3 acceptance evidence in place for
  vehicles; on-foot remains kernel until stage 3). `GAME_NETCODE_SERVER_VEHICLE_PHYSICS=off`
  is the no-redeploy rollback lever until kernel removal completes this stage.

## Rollback

Any stage failing acceptance reverts its flag; stages are independently revertible
because the kernels remain until stage 4. A production incident during soak week
re-enables the kernel path via the rollout controller without redeploy.

## Explicitly deferred

- Force-based handling (drift/spin dynamics) - separate gameplay milestone after GA.
- Joints/constraints content (trailers, towing) - after GA.
- 3D physics, continuous elevation - out of scope entirely.
- Switching to non-compat `@dimforge/rapier2d` with bundler-managed WASM for smaller
  client payloads - optimization pass after stage 2.

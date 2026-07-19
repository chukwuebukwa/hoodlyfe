# Multiplayer Adaptation Contract: Rapier2d Physics Migration

Date: 2026-07-19

Status: Code migration complete; production soak pending
Prerequisite evidence: `RAPIER_NETCODE_SPIKE_REPORT.md`

## Objective

Use one physics implementation for authoritative street simulation and client replay.
Rapier owns street-world collision and dynamic contacts. Game code owns control policy
and server-only outcomes such as damage and crime.

## Invariants

- The server remains authoritative for damage, crimes, arrests, economy, missions,
  spawning, and every execute-once outcome.
- Simulation stays fixed at 30 Hz and keeps the existing phase order.
- Replay changes pure state only; it never emits server outcomes.
- Activation, replication AOI, prediction islands, and presentation LOD remain
  independent scopes.
- Combat rewind and interior collision keep their existing ownership.

## Final ownership

- `shared/physics/physics-world.ts` owns Rapier initialization, static meshing, body
  registration, stepping, capture/writeback, and contact facts.
- `shared/simulation/vehicle-body-drive.ts` is the only vehicle-to-body drive recipe.
  Server and client must use it unchanged to preserve parity.
- Vehicle heading remains authored by `integrateVehiclePose`; vehicle bodies have
  locked rotation and zero angular velocity. Rapier's angular integration produced a
  deterministic bias of about 5e-6 rad/tick during the spike.
- Street vehicles, players, and pedestrians share one Rapier step. Vehicles collide
  with statics, vehicles, and humanoids. Humanoids collide with statics and vehicles,
  but not each other, preserving pedestrian pass-through.
- Dynamic bodies are rebuilt from the tick baseline in stable order before each step.
  This makes correction replay independent of Rapier warm-start state and body
  insertion history.
- Humanoids use predictive CCD to prevent one-tick wall penetration. Vehicles use CCD
  and the existing attempted-versus-achieved wall-damage policy.
- Interior walking continues to use authored rectangular occupancy because interior
  obstacles are not part of the street physics world.
- Rapier reports contacts; server controllers translate them into damage, crime, and
  cooldown outcomes. Client replay never applies those outcomes.

## Completed migration

### Stage 0 — adapter

The pinned `@dimforge/rapier2d-compat` adapter, deterministic trace tests, district
static mesh, and border walls landed dark.

### Stage 1 — authoritative vehicles

All vehicle motion moved through the shared body-drive recipe. Heading stayed
control-policy-authored. The 40-vehicle physics-step test remains below the 1 ms p95
budget.

### Stage 2 — vehicle prediction

Client prediction and interaction-island replay moved to Rapier. Server/client traces
are bit-identical through wall contact when damage modifiers are mirrored tick-aligned.
The proposed 12-tick replay cap and engine snapshot fallback were dropped: restoring
body state measured about 3e-4 px divergence at 30 ticks, so reconstruction added
complexity without useful accuracy. Angular/lateral velocity protocol fields were
deferred until force-based handling needs them.

### Stage 3 — humanoids and dynamic contacts

Street humanoids now join both worlds as balls. Rapier resolves vehicle/vehicle,
vehicle/humanoid, and actor/static contacts in one step. Damage thresholds preserve
the previous gameplay outcomes while the engine owns separation and impulse.

Acceptance evidence on 2026-07-19:

- production build green;
- focused server/client physics parity and on-foot impairment tests green;
- netcode suite 109/109 green;
- strict interaction-island soak and full-suite verification are release gates.

### Stage 4 — kernel removal

The bespoke street collision/contact kernels and
`GAME_NETCODE_SERVER_VEHICLE_PHYSICS` rollback flag are removed. Tests now exercise
Rapier directly. There is no dual simulation path to maintain or accidentally
double-resolve.

Production rollout still requires a week on real hardware and re-baselining the
impairment soak before this branch is treated as general availability.

## Release gates

- Full serial suite green. A lone multiplayer melee load-timing failure may be rerun
  once because it predates this migration.
- Strict interaction-island soak stays inside its checked-in error, replay-time, and
  determinism budgets.
- Pedestrian and police suites stay green.
- `test/multiplayer.integration.test.ts` passes 10 consecutive runs.
- Production hardware telemetry shows no physics-step or replay-cost regression during
  the soak week.

## Rollback

After kernel deletion, rollback means deploying the last pre-cutover revision. There
is intentionally no runtime switch and no second collision implementation.

## Deferred

- Force-based drift and spin dynamics.
- Joints and constraints such as trailers and towing.
- Non-compat Rapier packaging for a smaller browser bundle.
- 3D physics and continuous elevation remain out of scope.

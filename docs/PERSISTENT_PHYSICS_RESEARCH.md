# Persistent Server Physics Research and Rollout Report

Date: 2026-07-19

## Decision

The authoritative district now keeps one Rapier body per eligible vehicle, on-foot player,
and living pedestrian. A deterministic registry reconciles actor state before each
`dynamic-contacts` phase and each populated surface world steps once. Ordinary movement
updates velocity and rotation without writing translation. Translation is only written
when the Rapier pose differs from the authoritative tick-start pose by more than `0.001`
world units, and every such teleport is counted.

The rollout deliberately keeps `@dimforge/rapier2d-compat@0.19.3`, solver iterations,
`maxCcdSubsteps`, hard CCD, soft CCD, collision groups, and length-unit behavior unchanged.

## Research Findings

- Rapier retains broad-phase acceleration structures and contact graph state between
  steps. Recreating every dynamic body discards that retained work. See the
  [Rapier changelog](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md) and
  [collision architecture](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection/).
- Removing a rigid body removes attached colliders and joints and wakes touching bodies.
  That makes full per-tick removal a materially heavier operation than velocity updates.
  See the [Rapier World API](https://rapier.rs/javascript2d/classes/World.html).
- Dynamic bodies driven by velocity remain part of contact response. Kinematic bodies do
  not react to contact forces and are not suitable for the current vehicle/humanoid
  contract. See [rigid-body types](https://rapier.rs/docs/user_guides/javascript/rigid_body_type/).
- Direct translation is teleportation and is reserved for explicit correction. See the
  [position guide](https://rapier.rs/docs/user_guides/javascript/rigid_body_position/).
- Hard CCD has a computation cost and is intended for fast bodies. Soft CCD is cheaper,
  while large prediction distances increase broad-phase work. See
  [hard CCD](https://rapier.rs/docs/user_guides/javascript/rigid_body_ccd/) and the
  [soft CCD API](https://rapier.rs/javascript2d/classes/RigidBodyDesc.html).
- `lengthUnit` scales contact and activation tolerances and should represent a typical
  dynamic-body size in pixel-based worlds. It is a controlled follow-up, not part of this
  rollout. See the [Rapier World API](https://rapier.rs/javascript2d/classes/World.html).
- Colyseus recommends concurrent real-client load testing instead of estimating room
  capacity. See [load testing](https://docs.colyseus.io/tools/loadtest) and the
  [performance FAQ](https://docs.colyseus.io/faq).
- Colyseus room exception hooks distinguish simulation/timer failures from client-scoped
  auth, join, message, and leave failures. See
  [exception handling](https://docs.colyseus.io/room/exception-handling).
- Node's `uncaughtExceptionMonitor` observes fatal synchronous errors without changing
  normal fatal-exit behavior. See the
  [Node process guidance](https://nodejs.org/docs/latest-v20.x/api/process.html#warning-using-uncaughtexception-correctly).
- Event-loop delay histograms support reset, so health should report a current operational
  window rather than lifetime history. See
  [Node performance hooks](https://nodejs.org/api/perf_hooks.html).
- Railway health checks gate deployments but do not continuously poll a running service.
  Runtime recovery still requires process exit, restart policy, and an external monitor.
  See [Railway healthchecks](https://docs.railway.com/deployments/healthchecks) and
  [restart policy](https://docs.railway.com/deployments/restart-policy).

## Measurements

### Pre-change observations

| Measurement | Result |
| --- | --- |
| Churning 90-body, 10-world soak | RSS 114 MB at start, 254 MB at tick 10,000, about 250 MB at tick 60,000 |
| Prior 150-body engine feasibility step | p95 0.081 ms on the 64x64 map; p95 0.084 ms on the 96x96 map |
| Production sample during disconnect investigation | RSS 258 -> 493 -> 436 -> 258 MB; event-loop p99 about 21 ms with a 593 ms lifetime max |
| Failure evidence | Unexpected socket disconnects; no captured OOM, Rapier exception, or process crash signature |

The pre-change memory run plateaued after WASM growth, but still performed full body,
collider, contact-graph, and JavaScript map churn every tick. The production sample did
not prove physics caused the disconnects.

### Persistent implementation, local development Mac

Command: `npm run physics:soak`

| Profile | Ticks | Bodies / worlds | p50 | p95 | max | RSS tick 10k -> 60k | Lifecycle after creation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Normal | 60,000 | 45 / 10 | 0.100 ms | 0.123 ms | 1.612 ms | 261.98 -> 264.55 MB (+2.57 MB) | 0 remove/move/replace/teleport |
| Maximum | 60,000 | 90 / 10 | 0.157 ms | 0.201 ms | 1.658 ms | 274.64 -> 270.47 MB (-4.17 MB) | 0 remove/move/replace/teleport |

Both profiles pass the post-warmup RSS growth limit of less than 25 MB. External memory
held at 6.62 MB and array-buffer memory held at 0.07 MB from tick 10,000 onward in both
runs. Heap samples vary with V8 collection and are retained in the harness output.

### 32-client validation

The first short run found a non-physics replication limit: 32 clients plus population
streaming produced 88-96 KB schema patches while `Encoder.BUFFER_SIZE` was fixed at 64 KB.
Repeated overflow re-encoding coincided with client `refId not found` decoder errors.
The server remained healthy and reported physics p95 below 0.34 ms during that run.

The encoder now reserves 256 KB per room, which is more than twice the largest observed
patch. A corrected 30-second, 32-client run with two consented reconnect cycles reported:

| Signal | Result |
| --- | ---: |
| Decoder errors | 0 |
| Room errors | 0 |
| Reconnect errors | 0 |
| Unhealthy `/health` samples | 0 |
| Maximum physics p95 | 0.852 ms |
| Maximum event-loop p99 | 19.46 ms |
| Maximum RSS | 506.44 MB |

The final ten-minute acceptance run used 32 clients, continuous movement, interaction
every 15 seconds, population streaming, and a consented reconnect for every client every
two minutes:

| Signal | Result |
| --- | ---: |
| Successful reconnects | 128 |
| Interaction messages | 1,244 |
| Observed vehicle entries / exits | 186 / 168 |
| Decoder / room / reconnect errors | 0 / 0 / 0 |
| Unexpected disconnects | 0 |
| Unhealthy `/health` samples | 0 |
| Maximum physics p95 | 1.364 ms |
| Maximum event-loop p99 | 1,238.37 ms, transient |
| Maximum RSS | 662.72 MB |
| RSS change after the two-minute sample | +51.53 MB |
| Five-minute sustained threshold breaches | 0 |
| Harness result | PASS |

The event-loop maximum occurred in one reconnect/replication window and did not remain
above 100 ms. RSS stayed below the 750 MB rollback threshold, but its retained increase
means the one-hour production canary remains required; a ten-minute local run cannot
prove the absence of longer-term allocator growth. Immediately after the clients left,
the server was healthy with an 11 ms tick age, 0.780 ms physics p95, 659.34 MB RSS,
111.74 MB used heap, 9.80 MB external memory, and 0.85 MB array-buffer memory.

## Runtime Lifecycle

Each contact phase performs these operations in stable surface, actor-family, and entity
order:

1. Collect eligible actors.
2. Remove absent actor bodies.
3. Migrate bodies whose surface changed.
4. Replace bodies whose collision shape changed.
5. Create new bodies.
6. Synchronize velocity and rotation; teleport only beyond `0.001` units.
7. Step each populated surface world once.
8. Capture poses and stable contact pairs.

This single reconciliation path covers join/leave, death/respawn, vehicle entry/exit,
interior transitions, streamed population, mission/police spawning, destruction, shape
changes, explicit correction, and elevation migration.

F3 debug snapshots expose body/world/contact counts, per-tick and cumulative lifecycle
operations, teleports, and the existing 600-sample p50/p95/max timing window. A stable
district must show zero lifecycle operations and zero teleports on ordinary ticks.

## Failure and Health Contract

- `DistrictRoom` reports the active simulation phase and only records a successful tick
  after `simulation.advance()` returns.
- Room creation, simulation interval, and game-timer exceptions mark health fatal and
  start one `gracefullyShutdown(true, error)` call.
- A 10-second unref'd fallback exits with status 1 if graceful shutdown does not finish.
- Auth, join, message, leave, and dispose failures are logged without killing the process.
- `uncaughtExceptionMonitor` logs synchronous process failures without suppressing Node's
  normal fatal exit.
- A one-second watchdog triggers fatal shutdown if a ready room has no successful tick for
  five seconds.
- `/health` returns 503 while fatal, shutting down, or more than two seconds behind.
- `/health` reports RSS, heap, external, array-buffer, simulation phase/tick, physics, and
  a 60-second rolling event-loop histogram.

Railway remains configured with `/health` and `ON_FAILURE`. Configure Uptime Kuma outside
this repository with:

| Setting | Value |
| --- | --- |
| Monitor type | HTTP(s) |
| URL | `https://<production-domain>/health` |
| Method | GET |
| Heartbeat interval | 30 seconds |
| Retries | 1, so alerting starts after two consecutive failures |
| Accepted status | 200-299 |
| Notification | Production server alert channel |

External Uptime Kuma configuration requires access to the deployed monitor and cannot be
applied from a source checkout.

## Reproduction

```bash
# 60,000 ticks, 90 bodies, 10 worlds; exits non-zero at >=25 MB post-warmup RSS growth
npm run physics:soak

# Normal profile
PHYSICS_SOAK_BODIES=45 npm run physics:soak

# Start the server, then run 32 clients for ten minutes with two-minute reconnects
npm run dev:server
npm run physics:loadtest

# Ten drivers follow the authored road graph and must visit at least 65% of road sectors
npm run bots:map

# Add brief handbrake pulses to moving bot-driven cars during a load run
LOADTEST_DRIFT=1 npm run physics:loadtest

# Existing server/browser deterministic trace
npx tsx scripts/spike/browser-determinism.ts
```

`physics:loadtest` uses `@colyseus/loadtest@0.16.2`, sends continuous on-foot or vehicle
input, interacts every 15 seconds, reconnects with consent every two minutes, samples
`/health` every five seconds, and requires actual vehicle entry/exit and successful
reconnects. It fails on decoder, room, reconnect, unexpected-disconnect, or health errors,
and on physics p95, event-loop p99, or RSS rollback thresholds sustained for five minutes.
Set `LOADTEST_DRIFT=1` to add staggered 700 ms handbrake pulses to moving cars and cover
the drift handling path under concurrent load.

With `LOADTEST_MAP_TRAVERSAL=1`, bots compile `district-lanes.json` into connected,
steerable road waypoints, acquire and hold vehicles, recover from bounded stuck states,
and measure visited road sectors. A three-minute local run with ten bots visited 12 of 14
road sectors (85.71%), traveled 132,288 px, reached 209 waypoints, entered 25 vehicles,
and reported zero decoder, room, reconnect, unexpected-disconnect, or health errors.
The map mode fails below `LOADTEST_MIN_MAP_COVERAGE`, which defaults to 65%.

## Verification

| Check | Result |
| --- | --- |
| TypeScript and production Next build | PASS |
| Persistent lifecycle/health focused suite | 60/60 PASS |
| Node and Chromium deterministic reruns | `rerunMatch: true` in both runtimes |
| Cross-runtime deterministic trace | Bit-identical PASS |
| Writeback replay | PASS; maximum divergence 0.00000000745 px |
| 60,000-tick normal and maximum soaks | PASS |
| Final 32-client, ten-minute load gate | PASS |
| Full repository test suite | 531 PASS, 1 pre-existing failure |

The remaining full-suite failure is
`fleet scales to heat through delayed, clear, road-reachable reinforcements`, which
expects three managed police vehicles and receives two. The same isolated failure was
reproduced in a detached, clean worktree at pre-change commit `dfe5e14`; no police fleet
source or test is changed by this rollout.

## Rollout and Rollback

Deploy one fresh production process. Monitor actively for one hour, then review at 24
hours and one week. Roll back on any of these conditions:

- Two fatal restarts within 15 minutes.
- Physics p95 above 4 ms for five minutes.
- Event-loop p99 above 100 ms for five minutes.
- RSS above 750 MB for five minutes.
- Continued post-warmup memory growth.
- Stale or duplicate physics bodies, unexpected disconnects, or gameplay/determinism
  regression.

Do not combine this rollout with CCD tuning, `lengthUnit` changes, Rapier dependency
migration, deterministic-compat builds, or `RAPIER.reserveMemory()`. Benchmark those as
separate changes only after production persistence is stable.

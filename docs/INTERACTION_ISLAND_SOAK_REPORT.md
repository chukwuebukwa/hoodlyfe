# Interaction-Island M11 Soak Report

## Scope

The M11 gate runs eight independent simulated clients against one shared 48-body
authoritative street. Every client receives its own ordered reliable snapshot stream and
executes the production interaction-island selector, weighted admission policy, retained
history, mixed vehicle/humanoid kernels, stable pair resolution, remote-intent
continuation, and replay side-effect gate.

The 450-tick trace covers:

- dense vehicles, players, pedestrians, and movable props competing for a 32-point
  desktop island budget;
- on-foot to driver to on-foot controlled-root transitions;
- streamed entities leaving and re-entering with new lifecycle/collider revisions;
- vehicle destruction and respawn;
- pedestrian death and respawn;
- reliable WebSocket-style packet loss represented as ordered retransmission delay;
- a final authoritative snapshot flush proving exact convergence.

Run the strict dedicated gate with:

```bash
npm run test:netcode:soak
```

The strict command uses one test worker and fails if the acceptance profile exceeds the
2 ms replay p95 desktop target. The same soak also belongs to `npm run test:netcode`, with
an 8 ms shared-runner ceiling because unrelated concurrent test files can contend for the
same CPU.

## Checkpoint Results

Measured July 14, 2026 on the development workstation:

| Metric | Acceptance | Stress |
|---|---:|---:|
| RTT / jitter / loss | 150 ms / 30 ms / 1% | 250 ms / 45 ms / 2% |
| Clients / ticks | 8 / 450 | 8 / 450 |
| Successful / rejected replays | 1,808 / 0 | 1,808 / 0 |
| Maximum replay ticks | 8 | 13 |
| Maximum bodies | 18 | 19 |
| Maximum weighted budget | 32 / 32 | 32 / 32 |
| Overflow selections | 1,250 | 1,266 |
| Replay duration p95 | 0.195 ms | 0.252 ms |
| Replay duration maximum | 1.049 ms | 0.945 ms |
| Root position error p95 | 0.122 px | 0.660 px |
| Root position error maximum | 6.813 px | 31.279 px |
| Final convergence error | 0 px | 0 px |
| Suppressed / executed external effects | 14,759 / 0 | 24,862 / 0 |
| Simulated retransmissions | 7 | 38 |

Both profiles observed two occupancy transitions and two corresponding history resets.
Both observed stream-out, lifecycle-safe stream-in, destruction, vehicle respawn, and
humanoid respawn. Re-running the trace with the same seed produces identical admission,
replay, error, transition, overflow, and retransmission metrics; only wall-clock duration
is intentionally excluded from deterministic equality.

## Acceptance Mapping

- **Next-frame local input:** covered by the saved on-foot and saved-vehicle prediction
  tests in the permanent netcode gate.
- **One attachment root:** covered by the shared attachment-root and active-collider
  presentation contracts; island replay updates that same root.
- **Replay below 2 ms p95:** enforced by the strict dedicated soak.
- **Weighted budget:** every selection remained at or below 32 points under sustained
  overflow pressure.
- **No duplicate effects:** every injected presentation, gameplay, and durable effect was
  suppressed during replay; none executed.
- **Authority convergence:** both profiles converged exactly after the final reliable
  snapshot despite lifecycle and control-root discontinuities.

## Production Boundary

This gate is deterministic simulation QA. It catches kernel drift, admission overflow,
history mistakes, transition discontinuities, side-effect duplication, and replay-cost
regressions quickly enough for every branch. It does not model host CPU saturation,
garbage-collector pauses, Redis/presence failure, browser frame contention, mobile thermal
limits, or a real carrier network.

Before enabling interaction replay globally, staging still needs the regional room soak
from the production infrastructure plan: 32 real browser clients for at least one hour,
with live room CPU/memory, patch size, event-loop lag, reconnect, and region-specific RTT
telemetry. The negotiated M11 rollout manifest allows replay or snapshots to be disabled
without rolling back the shared simulation kernels if that staging gate regresses.

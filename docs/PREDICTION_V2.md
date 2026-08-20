# Prediction V2

## Runtime Flow

1. The browser samples local movement at the shared 60 Hz fixed step.
2. It assigns each input a sequence, predicts through the shared on-foot kernel, retains
   the input and pose, and sends a bounded batch to the district server.
3. The server processes ordered inputs at its fixed tick, validates authored surfaces and
   collisions, and replicates authority with `lastInputSequence`.
4. The browser removes acknowledged inputs, restores the authoritative pose, and replays
   remaining inputs in sequence.
5. Canonical predicted physics changes immediately. Corrections of at most 120 px retain
   a render-only offset that decays at rate 14 so presentation does not visibly snap.

The local body, weapon, attachments, labels, and camera consume the same final predicted
pose. The browser never sends positions and never owns damage, death, elevation, vehicle
occupancy, inventory, crime, missions, economy, or persistence.

## Current Policy

| Policy | Value |
|---|---:|
| Fixed step | 60 Hz |
| Saved history | 24 ticks / 400 ms |
| Maximum generated ticks per render frame | 4 |
| Hard correction threshold | 120 px |
| Render-offset decay | 14 / second |
| Transport assumption | Ordered, reliable Colyseus messages |

Prediction is active only while the player is alive, on foot, grounded, in street space,
on a known authored surface, and in a supported action. Missing map data, interiors,
falling, vehicles, and unsupported actions fail closed to legacy authoritative movement.

## Operations

Set `GAME_NETCODE_LOCAL_ON_FOOT_PREDICTION=1` to enable the negotiated stage. Set it to
`0` and restart district rooms for immediate rollback. Protocol mismatch also falls back
to authoritative movement.

Open `F3` or `DBG` and inspect **On-foot prediction**:

- `seq/ack` exposes input progress.
- `pending/replay` exposes unacknowledged history and reconciliation work.
- `error/corrections/resets` exposes divergence.
- `reason` explains why prediction is inactive.

## Next Milestones

1. Run repeatable latency, jitter, packet-loss, bridge, and interior transition soaks.
2. Restore a shared predicted vehicle kernel with saved-input rewind/resimulation.
3. Add server interaction snapshots and bounded nearby-body island selection.
4. Replay selected contacts in stable ID order with strict desktop/mobile budgets.
5. Suppress gameplay and presentation side effects during replay.

Full interaction islands are not implied by this milestone. Remote actors still use
timestamped interpolation and local vehicles remain server-authoritative.

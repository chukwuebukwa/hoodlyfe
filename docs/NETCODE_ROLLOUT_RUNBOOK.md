# Netcode Rollout Runbook

The server owns movement, collision, elevation, and combat outcomes. The browser sends
sequenced intent. Grounded street movement can be predicted locally and reconciled to
server acknowledgements; unsupported states fall back to authoritative rendering.
Interaction snapshots, multi-body interaction replay, and provisional projectiles are
not deployed runtime stages.

## Stages

| Stage | Environment key | Safe disabled behavior |
|---|---|---|
| Local on-foot prediction | `GAME_NETCODE_LOCAL_ON_FOOT_PREDICTION` | Send legacy movement intent and render server authority |
| Remote timelines | `GAME_NETCODE_REMOTE_TIMELINES` | Render the latest replicated pose |
| Combat rewind | `GAME_NETCODE_COMBAT_REWIND` | Use current-time fire authority |

All flags default to enabled. Accepted values are `1/0`, `true/false`, `on/off`, and
`enabled/disabled`. `GAME_NETCODE_ROLLOUT_REVISION` supplies a short deployment ID.
Invalid values fail room startup.

A client must negotiate rollout protocol v4 and combat protocol v6. Failure falls back
to legacy authoritative movement and fire commands plus latest-pose rendering.

## Verification

Open `F3` or `DBG`. A healthy current deployment reads:

```text
negotiated / <revision> / on-foot,timeline,rewind
```

Also inspect RTT, patch gap, clock synchronization, interpolation buffer age/underrun,
the authoritative physical surface, server simulation-phase timings, and the on-foot
prediction row. The prediction row reports sequence/acknowledgement, pending and replayed
inputs, correction error, correction count, reset count, and fallback reason.

## Rollback

1. Disable `GAME_NETCODE_LOCAL_ON_FOOT_PREDICTION` if local reconciliation regresses.
2. Disable `GAME_NETCODE_COMBAT_REWIND` if historical hit queries regress.
3. Disable `GAME_NETCODE_REMOTE_TIMELINES` if interpolation regresses.

Restart district rooms after changing flags. Record revision, region, build, and F3
timing metrics in the release log.

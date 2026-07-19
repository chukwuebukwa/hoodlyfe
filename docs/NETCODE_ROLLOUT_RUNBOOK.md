# Netcode Rollout Runbook

The server owns movement, collision, and combat outcomes. The browser sends intent and
renders replicated state. Client prediction, reconciliation, interaction snapshots,
interaction replay, and provisional projectiles are not deployed runtime stages.

## Stages

| Stage | Environment key | Safe disabled behavior |
|---|---|---|
| Remote timelines | `GAME_NETCODE_REMOTE_TIMELINES` | Render the latest replicated pose |
| Combat rewind | `GAME_NETCODE_COMBAT_REWIND` | Use current-time fire authority |

Both flags default to enabled. Accepted values are `1/0`, `true/false`, `on/off`, and
`enabled/disabled`. `GAME_NETCODE_ROLLOUT_REVISION` supplies a short deployment ID.
Invalid values fail room startup.

A client must negotiate rollout protocol v3 and combat protocol v6. Failure falls back
to latest-pose rendering and the legacy authoritative fire command.

## Verification

Open `F3` or `DBG`. A healthy current deployment reads:

```text
negotiated / <revision> / timeline,rewind
```

Also inspect RTT, patch gap, clock synchronization, interpolation buffer age/underrun,
the authoritative physical surface, and server simulation-phase timings.

## Rollback

1. Disable `GAME_NETCODE_COMBAT_REWIND` if historical hit queries regress.
2. Disable `GAME_NETCODE_REMOTE_TIMELINES` if interpolation regresses.

Restart district rooms after changing flags. Record revision, region, build, and F3
timing metrics in the release log.

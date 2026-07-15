# Netcode Rollout Runbook

## Compatibility Floor

Shared on-foot, vehicle, static-collision, and vehicle-to-humanoid kernels are the
mandatory compatibility floor. They are not a runtime toggle because authority and
prediction must execute the same rules. A kernel change requires a protocol version
bump and a coordinated deployment.

The stages above that floor are independently deployable:

| Stage | Environment key | Safe disabled behavior |
|---|---|---|
| Remote timelines | `GAME_NETCODE_REMOTE_TIMELINES` | Direct bounded interpolation |
| Interaction snapshots | `GAME_NETCODE_INTERACTION_SNAPSHOTS` | No island baseline bandwidth |
| Interaction replay | `GAME_NETCODE_INTERACTION_REPLAY` | Local-body prediction only |
| Combat rewind | `GAME_NETCODE_COMBAT_REWIND` | Current-time legacy fire authority |
| Projectile prediction | `GAME_NETCODE_PROJECTILE_PREDICTION` | Authoritative projectile presentation |

All flags default to enabled to preserve the current branch behavior. Accepted values
are `1/0`, `true/false`, `on/off`, and `enabled/disabled`. Set
`GAME_NETCODE_ROLLOUT_REVISION` to a short deployment or experiment identifier.

## Dependency Rules

- Interaction replay requires interaction snapshots.
- Projectile prediction requires combat rewind receipts.
- Invalid booleans, revisions, or dependency combinations fail room startup.
- A client that cannot negotiate the exact rollout and interaction protocol versions
  remains on kernel-only legacy behavior. It cannot self-enable server authority stages.

## Verification

Open `F3` or `DBG` and inspect **Netcode rollout**. A healthy current deployment reads:

```text
negotiated / <revision> / timeline,snapshot,island,rewind,projectile
```

`pending`, `legacy-fallback`, or `rejected` means the client is not running the requested
advanced stages. The row includes the rejection reason when validation fails. Confirm
the row before comparing island, prediction, or combat diagnostics.

## Rollback Order

1. Disable `GAME_NETCODE_INTERACTION_REPLAY`; keep snapshots on for observation.
2. Disable `GAME_NETCODE_INTERACTION_SNAPSHOTS` after replay is off.
3. Disable `GAME_NETCODE_PROJECTILE_PREDICTION`; keep rewind on for authority metrics.
4. Disable `GAME_NETCODE_COMBAT_REWIND` after projectile prediction is off.
5. Disable remote timelines independently if interpolation diagnostics regress.

Restart district rooms after changing flags. Do not mix manifests inside one room. Record
the revision, region, build, impairment profile, and F3 metrics in the release log.

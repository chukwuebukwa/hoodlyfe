# Arena Deathmatch

## Player Flow

Deathmatch is a dedicated authoritative activity room, parallel to the raceway:

1. Enter freeroam and open the phone.
2. Open **Jobs**.
3. Choose **Deathmatch** and select **Enter arena**.
4. Fight through automatically restarting rounds.
5. Open **Jobs** and select **Exit to Freeroam**.

`/deathmatch` is retained as a direct development and QA shortcut. Runtime travel validates and
starts the destination room before removing the source presentation, so a failed join can recover
without leaving the player in a black screen.

## Foundry Yard Rules

The initial `foundry-yard` arena is a compact, traffic-free 48x48 tile map:

- free-for-all scoring;
- five-second authoritative countdown;
- first player to 15 eliminations or the highest score after eight minutes;
- three-second respawns at one of eight distributed spawn poses;
- 100 health, 50 armor, and an authoritative pistol/SMG/shotgun loadout;
- twelve-second results phase followed by an automatic restart;
- $1,500 winner payout and $300 participation payout.

The server owns phase changes, score, deaths, streaks, placement, spawn assignment, loadout,
respawn timing, winner selection, and payout idempotency. Client input is disabled during
countdown and results. Arena damage does not create wanted heat, freeroam kill bounties, or
death-cash drops.

The initial room starts a countdown with one entrant to support solo testing. Matchmaking can
enforce minimum player counts later without changing arena simulation.

## Architecture

Content and tuning live in `shared/content/arena-deathmatch.ts`.
`ArenaDeathmatchController` owns match state and observes the shared authoritative combat event
stream. It does not implement separate weapon or damage rules; the normal fire, projectile,
melee, armor, lifecycle, and replication systems remain the source of truth.

`DistrictDeathmatchRoom` selects the arena definition and generated map package. The phone and
world catalog treat freeroam, raceway, and deathmatch as destinations rather than route-specific
applications. This keeps future arenas, team modes, and matchmaking outside `DistrictRoom`.

The generated package under `public/assets/districts/deathmatch` contains collision, surface,
Three geometry, minimap, map, and tileset artifacts. Regenerate it with:

```bash
npm run map:generate-deathmatch
```

## Economy Boundary

Match payouts currently use the server-authoritative street economy transaction port and are
idempotent for a round. Cash is still room-local across all game modes, so an awarded balance is
not yet durable when traveling back to freeroam.

The progression loop requires a later account service to load a durable balance into each room
and commit activity-result transactions against account identity. The deathmatch controller
should continue emitting only typed activity payouts; it must not write directly to a database
or wallet.

## Next Milestones

- durable account identity and cross-room reward settlement;
- matchmaking, parties, minimum roster, and reconnect grace;
- late-join spectator policy and explicit ready state;
- selectable validated loadouts and weapon pickups;
- spawn danger scoring using enemy distance, line of sight, and recent deaths;
- additional maps, score/time presets, teams, assists, and post-match summary;
- anti-collusion and match-result audit records.


# Simulation Journal and Deterministic Replay

Date: 2026-07-20

The simulation journal records everything the authoritative district simulation needs to be
re-run bit-for-bit: the seed and epoch, every simulation-affecting client command at the
tick it applied, the drained game events per tick, and periodic state hashes for
divergence detection. It is the durable recording layer anticipated by
[`DEBUG_OBSERVABILITY_RESEARCH.md`](DEBUG_OBSERVABILITY_RESEARCH.md); the live
`DebugSnapshotController` remains the bounded developer projection and is unchanged.

## Why this works

The server simulation was already deterministic by construction:

- `FixedStepClock` advances the world in fixed 16.67 ms ticks.
- `DeterministicRandom` is stateless and keyed by `(seed, stream, key)`, so random draws
  do not depend on call order.
- The engine physics world registers bodies in deterministic order at a fixed timestep.
- Clients send intent only; all gameplay outcomes are server-owned.

The journal adds the two missing pieces: a record of the non-deterministic inputs (client
commands, joins, leaves, the wall-clock epoch) and verification hashes. World-clock reads
inside the room derive from `epochMs + simulationClock.nowMs` instead of `Date.now()`, so
replays reproduce world time exactly.

## File format

JSONL. The first line is a header; every following line is one record:

```jsonl
{"kind":"header","version":1,"seed":1234,"epochMs":1752969600000,"stepMs":16.67,"hashIntervalTicks":60,"collisionRevision":2,"rolloutRevision":"server-authority","recordedAt":"..."}
{"kind":"spawn","tick":0,"sessionId":"abc","name":"Player 1"}
{"kind":"command","tick":5,"sessionId":"abc","type":"on-foot.input","payload":{"moves":[...]}}
{"kind":"events","tick":25,"events":[{"type":"weapon.fired","tick":25,...}]}
{"kind":"hash","tick":30,"value":2895061186}
{"kind":"leave","tick":90,"sessionId":"abc"}
```

Record semantics:

- `spawn` / `leave` are written at application time (after auth resolves), not at message
  arrival, so replay does not depend on auth latency.
- `command` records carry the tick the command applied at. Commands recorded at tick `T`
  arrived after tick `T` completed and before tick `T+1` ran.
- `events` are the full typed `GameEvent` payloads drained that tick — grep-friendly
  ground truth for debugging without running a replay.
- `hash` is a deterministic FNV-1a digest of the replicated simulation state (players,
  npcs, vehicles, projectiles, explosions, fires, pickups, traffic signals), computed in
  the `snapshot-observability` phase every `hashIntervalTicks` ticks.

Journal write failures disable the journal; they never block or mutate the simulation.

## Recording

- Production/dev server: set `GAME_JOURNAL_DIR=journals` and each district room writes
  `journals/district-<roomId>-<timestamp>.jsonl`.
- Programmatic: pass `journalSink` (for example `MemoryJournalSink`) and optionally
  `journalHashIntervalTicks` in the room creation options, plus `seed` and `epochMs` for
  fully pinned sessions.

## Replaying

```bash
npx tsx server/game/journal/replay-cli.ts journals/district-abc-2026-07-20.jsonl
```

The CLI (and `replayJournal()` in `server/game/journal/journal-replay.ts`) boots a
headless `DistrictRoom` with `externalSimulation: true`, re-creates the world from the
header, steps ticks manually, applies journaled spawns/commands/leaves at their recorded
tick boundaries, and compares every recorded hash. Exit code 1 and a per-tick divergence
report if the replay does not match — the first divergent tick is where to start looking.

Debugging workflow for agents: reproduce a bug once with recording on, then iterate on
the frozen journal. Bisect by hash divergence tick, read the `events` records around it,
and re-run the replay after a fix to confirm the divergence (or the bug's event trail)
changes.

## Caveats

- Replay requires the same build: same surface manifest (`collisionRevision` is checked
  into the header), same JS engine, same simulation code (the bespoke engine is pure
  TypeScript — no WASM is involved). A journal from an older
  git revision should be replayed on that revision.
- Non-simulation messages (pings, wardrobe reads, debug subscriptions, netcode manifest
  requests) are intentionally not recorded.
- Spectator joins are not recorded; they do not affect the simulation.
- New simulation-affecting messages must register through `registerJournaledCommand` in
  `DistrictRoom`, or replays will silently miss them. Same for any new `Date.now()` use in
  simulation paths — derive from the room epoch and fixed-step clock instead.

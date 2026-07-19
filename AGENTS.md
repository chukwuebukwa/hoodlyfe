# Agent Notes — NOCK0

## Simulation journal: record everything, replay anything

The authoritative server simulation is deterministic and has a flight recorder. Every
game session should be recorded, and every gameplay bug should be debugged from a
recording rather than by trying to reproduce it live. Full spec:
[`docs/SIMULATION_JOURNAL.md`](docs/SIMULATION_JOURNAL.md).

### Always record

Run the dev server with recording on. Do this by default whenever you launch the game —
for playtests, soak runs, feature verification, anything:

```bash
GAME_JOURNAL_DIR=journals npm run dev:server
```

Each district room writes `journals/district-<roomId>-<timestamp>.jsonl`: a header
(seed, epoch, collision revision), every simulation-affecting client command at the tick
it applied, all drained game events per tick, and a state hash every 30 ticks. Cost is
negligible; there is no reason to run without it during development.

### Debug from a journal

The tick rate is 30/sec ("2 minutes in" ≈ tick 3600). Start by reading, not replaying —
the `events` records are grep-able ground truth:

```bash
# What died, and to what?
grep '"entity.killed"' journals/<file>.jsonl
# All damage events, with jq:
jq -c 'select(.kind=="events") | .events[] | select(.type=="damage.applied")' journals/<file>.jsonl
```

To verify a session reproduces bit-for-bit, or to find where determinism broke:

```bash
npx tsx server/game/journal/replay-cli.ts journals/<file>.jsonl
```

Exit 0 = the whole session rebuilt identically. Exit 1 prints the first divergent tick —
that is where to start looking. Journals are pinned to the git revision that recorded
them; replay on that revision. The deliberate exception: to prove a refactor preserved
simulation behavior, record before the change and replay after — matching hashes are the
proof.

### Author scenarios headlessly

You can drive the full server sim without a browser or network — useful for reproducing
a situation, testing a feature, or bisecting (a 120-tick record+replay cycle runs in
under a second, so iterate freely):

```ts
const room = new DistrictRoom();
await room.onCreate({seed: 1234, epochMs: 1_000_000, journalSink: new MemoryJournalSink(),
  externalSimulation: true});
room.applyJournaledSpawn('p1', {name: 'Tester'});
room.applyJournaledCommand('p1', ON_FOOT_INPUT_MESSAGE, {moves: [{sequence: 1, x: 1, y: 0}]});
room.stepSimulationTick(); // one fixed 33.33ms tick
```

See `test/journal-replay.test.ts` for a complete scripted session.

### Rules that keep replay trustworthy

- New simulation-affecting client messages MUST register through
  `registerJournaledCommand` in `server/district-room.ts`, or replays silently miss them.
- Never call `Date.now()` / `Math.random()` in simulation paths. Derive time from the
  room epoch plus the fixed-step clock; derive randomness from `DeterministicRandom`
  with a named stream and stable key.
- New replicated sim state should be added to the field lists in
  `server/game/journal/state-hash.ts` so divergence detection covers it.
- The determinism tripwire is `test/journal-replay.test.ts` — if it fails after your
  change, you introduced nondeterminism; the divergence tick tells you where.

### When the user reports a gameplay bug

Ask for (or locate) the journal from that session plus a rough time ("around 3 minutes
in"), convert to a tick (×1800/min), read the events around it, and iterate against the
frozen journal — do not burn time trying to reproduce live first.

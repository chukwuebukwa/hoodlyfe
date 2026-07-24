# Arena Racing

## Current Mode

`/race` joins the dedicated `district-race` Colyseus room. It does not share ambient traffic,
police, missions, services, or population with the street district.

The first track is `industrial-arena-circuit`:

- six starting slots;
- assigned R33/S15 race cars;
- five-second authoritative countdown;
- nine ordered checkpoints;
- three laps;
- server-owned position, finish order, lap time, and best lap;
- twelve-second results phase followed by an automatic restart.

The browser renders the map package from `public/assets/districts/raceway`. The server loads
collision and lane data from the same package, so presentation and authority use one generated
artifact.

## Local Use

Start the normal client and district server, then open:

```text
http://127.0.0.1:5173/race
```

Open the same URL in additional browser sessions to fill the six-car grid.

## Regenerating The Circuit

The circuit is generated from the local Industrial District tiles:

```bash
npm run map:generate-raceway
```

The generator writes:

- the cropped tile map and tileset;
- Three geometry chunks and texture atlas;
- the minimap preview;
- collision/surface metadata;
- a traffic-free 72x72 map on a 40 px collision grid.

The finer grid produces smoother collision boundaries than the street district's 64 px cells.
The resulting 2880x2880 course is intentionally wider than the first compact prototype and does
not include lane topology because arena races do not run ambient traffic.

Track rules, checkpoints, and grid poses live in
`shared/content/arena-race.ts`. The authoritative lifecycle is isolated in
`server/game/races/arena-race-controller.ts`.

## Adding Another Arena

1. Add a generator or authored map package under `public/assets/districts/<arena-id>`.
2. Define an `ArenaRaceTrackDefinition` with a stable ID, asset root, ordered checkpoints,
   lap count, and grid poses.
3. Add a room subclass that returns the track definition and package maps directory.
4. Register that room in `server/index.ts`.
5. Add a route that passes the room name and asset root to `GameRuntimeMount`.
6. Add controller tests that cross every checkpoint in order and verify cleanup/restart.

Race state remains server authoritative. A client may predict its assigned vehicle for immediate
controls, but it cannot advance checkpoints, complete laps, choose finishing position, or move
during countdown/results.

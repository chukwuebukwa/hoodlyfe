# Arena Racing

## Current Mode

The in-game phone is the primary way to enter the dedicated `district-race` Colyseus room.
Open **Jobs**, choose **Raceway**, and select **Enter raceway**. The same phone screen
provides **Return to city** from the circuit.

`/race` remains available as a direct QA shortcut. The race room does not share ambient traffic,
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

The normal game can exercise the integrated flow without changing routes:

1. Open the phone.
2. Select **Jobs**.
3. Select **Enter raceway**.
4. After testing the circuit, open **Jobs** and select **Return to city**.

The runtime joins and validates the destination room before removing the current world
presentation. It keeps the source room available until the destination client has started, so a
failed load can restore the previous district instead of leaving a black screen. Input is blocked
under the loading transition.

Driver identity and appearance carry across the room change. Cash, inventory, vehicles, heat,
and activity progress remain authoritative to each room until those systems move to the planned
persistent account/session service.

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
5. Register the world in `src/game/runtime/world-catalog.ts`.
6. Expose it through an activity projection or matchmaking flow.
7. Add controller tests that cross every checkpoint in order and verify cleanup/restart.

Race state remains server authoritative. A client may predict its assigned vehicle for immediate
controls, but it cannot advance checkpoints, complete laps, choose finishing position, or move
during countdown/results.

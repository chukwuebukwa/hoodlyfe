import assert from 'node:assert/strict';
import test from 'node:test';
import {ArenaRaceController} from '../server/game/races/arena-race-controller.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import type {
  ArenaRaceTrackDefinition,
  RaceGridPose
} from '../shared/content/arena-race.ts';

const TRACK: ArenaRaceTrackDefinition = {
  id: 'test-circuit',
  label: 'Test Circuit',
  assetRoot: '/test',
  laps: 1,
  checkpoints: [
    {id: 'start-finish', x: 100, y: 100, radius: 20},
    {id: 'turn-one', x: 100, y: 300, radius: 20},
    {id: 'turn-two', x: 300, y: 300, radius: 20},
    {id: 'turn-three', x: 300, y: 100, radius: 20}
  ],
  grid: [
    {x: 100, y: 140, angle: -Math.PI / 2},
    {x: 100, y: 180, angle: -Math.PI / 2}
  ]
};

test('arena race holds the grid and only finishes after every checkpoint and the line', () => {
  const harness = createHarness();
  const player = playerState('driver-1');
  harness.state.players.set(player.id, player);
  harness.controller.register(player);

  const entrant = harness.state.race.entrants.get(player.id);
  assert.ok(entrant);
  const vehicle = harness.state.vehicles.get(entrant.vehicleId);
  assert.ok(vehicle);

  harness.controller.update(0);
  assert.equal(harness.state.race.phase, 'countdown');
  vehicle.x = 800;
  vehicle.y = 800;
  harness.controller.update(1_000);
  assert.deepEqual(
    {x: vehicle.x, y: vehicle.y},
    {x: TRACK.grid[0].x, y: TRACK.grid[0].y}
  );

  harness.controller.update(5_000);
  assert.equal(harness.state.race.phase, 'racing');
  assert.equal(entrant.lap, 1);
  assert.equal(entrant.checkpointIndex, 1);

  crossCheckpoint(harness.controller, vehicle, TRACK.checkpoints[1], 5_600, 6_200);
  assert.equal(entrant.checkpointIndex, 2);
  crossCheckpoint(harness.controller, vehicle, TRACK.checkpoints[2], 6_800, 7_400);
  assert.equal(entrant.checkpointIndex, 3);
  crossCheckpoint(harness.controller, vehicle, TRACK.checkpoints[3], 8_000, 8_600);
  assert.equal(entrant.checkpointIndex, 0);
  assert.equal(entrant.finished, false, 'the last turn is not the finish line');

  crossCheckpoint(harness.controller, vehicle, TRACK.checkpoints[0], 9_200, 9_800);
  assert.equal(entrant.finished, true);
  assert.equal(entrant.finishTimeMs, 4_200);
  assert.equal(entrant.bestLapMs, 4_200);
  assert.equal(harness.state.race.phase, 'results');
  assert.match(harness.notices.at(-1)?.message ?? '', /Finished P1/);
});

test('arena race orders entrants by progress and removes their assigned car on leave', () => {
  const harness = createHarness();
  const first = playerState('driver-b');
  const second = playerState('driver-a');
  harness.state.players.set(first.id, first);
  harness.state.players.set(second.id, second);
  harness.controller.register(first);
  harness.controller.register(second);
  harness.controller.update(0);
  harness.controller.update(5_000);

  const secondEntrant = harness.state.race.entrants.get(second.id);
  const secondVehicle = secondEntrant
    ? harness.state.vehicles.get(secondEntrant.vehicleId)
    : undefined;
  assert.ok(secondEntrant);
  assert.ok(secondVehicle);
  crossCheckpoint(harness.controller, secondVehicle, TRACK.checkpoints[1], 5_600, 6_200);
  assert.equal(secondEntrant.position, 1);

  const removedVehicleId = secondEntrant.vehicleId;
  harness.controller.unregister(second.id);
  assert.equal(harness.state.race.entrants.has(second.id), false);
  assert.equal(harness.state.vehicles.has(removedVehicleId), false);
  assert.equal(second.vehicleId, '');
  assert.equal(second.vehicleSeat, -1);
});

function createHarness(): {
  state: DistrictState;
  controller: ArenaRaceController;
  notices: Array<{playerId: string; message: string}>;
} {
  const state = new DistrictState();
  const notices: Array<{playerId: string; message: string}> = [];
  const controller = new ArenaRaceController({
    state,
    track: TRACK,
    spawnVehicle: (player, pose, gridIndex) => {
      const vehicle = new VehicleState();
      vehicle.id = `race:${player.id}`;
      vehicle.kind = gridIndex % 2 === 0 ? 'r33' : 's15';
      relocate(vehicle, pose);
      vehicle.driverId = player.id;
      state.vehicles.set(vehicle.id, vehicle);
      player.vehicleId = vehicle.id;
      player.vehicleSeat = 0;
      return vehicle;
    },
    resetVehicle: relocate,
    removeVehicle: (vehicleId) => {
      state.vehicles.delete(vehicleId);
    },
    notice: (playerId, message) => {
      notices.push({playerId, message});
    }
  });
  return {state, controller, notices};
}

function playerState(id: string): PlayerState {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  return player;
}

function relocate(vehicle: VehicleState, pose: RaceGridPose): void {
  vehicle.x = pose.x;
  vehicle.y = pose.y;
  vehicle.angle = pose.angle;
  vehicle.speed = 0;
  vehicle.linvelX = 0;
  vehicle.linvelY = 0;
  vehicle.angvel = 0;
}

function crossCheckpoint(
  controller: ArenaRaceController,
  vehicle: VehicleState,
  checkpoint: {x: number; y: number},
  enterAt: number,
  leaveAt: number
): void {
  vehicle.x = checkpoint.x;
  vehicle.y = checkpoint.y;
  controller.update(enterAt);
  vehicle.x = 700;
  vehicle.y = 700;
  controller.update(leaveAt);
}

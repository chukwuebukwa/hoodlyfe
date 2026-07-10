import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {FreemodeMissionController} from '../server/game/missions/freemode-mission-controller.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {attachTestVehicleAccess} from './support/vehicle-access.ts';
import {attachTestTrafficController} from './support/traffic-controller.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

test('district mission adapter completes shared work, pays once, and releases its target', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  attachTestTrafficController(room);
  attachTestVehicleAccess(room);
  attachTestVehicleSimulation(room);
  room.state.missionContactX = room.world.spawn.x;
  room.state.missionContactY = room.world.spawn.y;
  room.missionController = new FreemodeMissionController({
    state: room.state,
    world: room.world,
    events: room.events,
    clock: () => ({tick: room.simulationClock.tick, nowMs: room.simulationClock.nowMs}),
    notice: () => undefined,
    releaseDeliveredVehicle: (vehicle: VehicleState, nowMs: number) => room.vehicleSimulation.returnToTraffic(
      vehicle,
      nowMs
    )
  });

  const leader = createPlayer('leader', room.world.spawn.x, room.world.spawn.y);
  const support = createPlayer('support', room.world.spawn.x + 24, room.world.spawn.y);
  room.state.players.set(leader.id, leader);
  room.state.players.set(support.id, support);
  room.runtimePlayers.set(leader.id, {inputX: 0, inputY: 0, lastShotAt: 0});
  room.runtimePlayers.set(support.id, {inputX: 0, inputY: 0, lastShotAt: 0});

  const trafficSpawn = room.world.trafficSpawn(88, 20);
  const target = new VehicleState();
  target.id = 'traffic-mission';
  target.x = trafficSpawn.x;
  target.y = trafficSpawn.y;
  target.angle = trafficSpawn.angle;
  target.traffic = true;
  room.state.vehicles.set(target.id, target);
  room.trafficController.register(target.id, trafficSpawn, 110);

  room.missionController.start(leader.id);
  const missionState = [...room.state.missions.values()][0];
  assert.ok(missionState);
  room.missionController.join(support.id, missionState.id);
  room.missionController.launch(leader.id, missionState.id);
  assert.equal(room.state.missions.get(missionState.id)?.participants.size, 2);
  assert.equal(room.state.missions.get(missionState.id)?.phase, 'steal');

  target.traffic = false;
  target.driverId = support.id;
  support.vehicleId = target.id;
  support.vehicleSeat = 0;
  support.wanted = 1;
  room.missionController.update(1000);
  assert.equal(room.state.missions.get(missionState.id)?.phase, 'lose-heat');

  support.wanted = 0;
  room.missionController.update(1100);
  const deliveryState = room.state.missions.get(missionState.id);
  assert.equal(deliveryState?.phase, 'deliver');
  target.x = deliveryState.deliveryX;
  target.y = deliveryState.deliveryY;
  target.speed = 0;
  room.missionController.update(1200);
  assert.equal(room.state.missions.get(missionState.id)?.phase, 'completed');
  assert.equal(leader.cash, 750);
  assert.equal(support.cash, 750);

  room.missionController.update(1300);
  assert.equal(leader.cash, 750);
  assert.equal(support.cash, 750);
  assert.deepEqual(
    room.events.drain()
      .filter((event: {type: string}) => event.type === 'mission.payout')
      .map((event: {playerId: string; amount: number}) => [event.playerId, event.amount]),
    [['leader', 750], ['support', 750]]
  );

  room.missionController.update(6000);
  assert.equal(room.state.missions.has(missionState.id), false);
  assert.equal(room.missionController.get(missionState.id), undefined);
  assert.equal(target.traffic, true);
  assert.equal(target.driverId, '');
  assert.equal(target.health, target.maxHealth);
  assert.equal(support.vehicleId, '');
});

function createPlayer(id: string, x: number, y: number): PlayerState {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  player.x = x;
  player.y = y;
  return player;
}

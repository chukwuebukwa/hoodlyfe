import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {
  VEHICLE_SIMULATION_STEP_SECONDS
} from '../shared/simulation/vehicle-step.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

test('authoritative contacts step every vehicle before resolving stable pairs', () => {
  const fixture = contactFixture(['alpha', 'bravo']);

  advanceContactTick(fixture, ['alpha', 'bravo']);

  assert.ok(fixture.vehicles.alpha.x < fixture.vehicles.bravo.x);
  assert.ok(fixture.vehicles.alpha.speed < 120);
  assert.ok(fixture.vehicles.bravo.speed < 120);
  assert.equal(fixture.players.alpha.x, fixture.vehicles.alpha.x);
  assert.equal(fixture.players.bravo.x, fixture.vehicles.bravo.x);
  assert.ok(fixture.room.events.drain().every((event: {sourceKind?: string}) => (
    event.sourceKind !== 'world'
  )), 'Dynamic contact was also reported as a wall impact.');
});

test('authoritative contact outcome is independent of map and body update order', () => {
  const forward = contactFixture(['alpha', 'bravo']);
  const reverse = contactFixture(['bravo', 'alpha']);

  advanceContactTick(forward, ['alpha', 'bravo']);
  advanceContactTick(reverse, ['bravo', 'alpha']);

  assert.deepEqual(snapshot(reverse), snapshot(forward));
});

test('parallel wall contact does not turn dynamic displacement into wall damage', () => {
  const fixture = contactFixture(['alpha', 'bravo']);
  fixture.vehicles.alpha.y = 15.9;
  fixture.vehicles.bravo.y = 15.9;

  advanceContactTick(fixture, ['alpha', 'bravo']);

  assert.ok(fixture.room.events.drain().every((event: {sourceKind?: string}) => (
    event.sourceKind !== 'world'
  )));
});

function contactFixture(insertionOrder: readonly VehicleId[]) {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const players = {
    alpha: player('driver-alpha', 'alpha'),
    bravo: player('driver-bravo', 'bravo')
  };
  const vehicles = {
    alpha: vehicle('alpha', players.alpha.id, 1000, 0, 120),
    bravo: vehicle('bravo', players.bravo.id, 1050, Math.PI, 120)
  };
  for (const id of insertionOrder) {
    room.state.players.set(players[id].id, players[id]);
    room.state.vehicles.set(id, vehicles[id]);
  }
  attachTestVehicleSimulation(room);
  for (const driver of Object.values(players)) {
    room.playerControl.register(driver.id);
    room.playerControl.setMove(driver.id, {x: 0, y: 0});
  }
  return {room, players, vehicles};
}

function advanceContactTick(
  fixture: ReturnType<typeof contactFixture>,
  updateOrder: readonly VehicleId[]
): void {
  fixture.room.vehicleSimulation.beginTick();
  for (const id of updateOrder) {
    fixture.room.vehicleSimulation.update(
      fixture.vehicles[id],
      VEHICLE_SIMULATION_STEP_SECONDS,
      1000
    );
  }
  fixture.room.vehicleSimulation.stepPhysics(VEHICLE_SIMULATION_STEP_SECONDS, 1000);
}

function player(id: string, vehicleId: VehicleId): PlayerState {
  const state = new PlayerState();
  state.id = id;
  state.vehicleId = vehicleId;
  state.vehicleSeat = 0;
  return state;
}

function vehicle(
  id: VehicleId,
  driverId: string,
  x: number,
  angle: number,
  speed: number
): VehicleState {
  const state = new VehicleState();
  state.id = id;
  state.kind = 'sedan';
  state.driverId = driverId;
  state.x = x;
  state.y = 1000;
  state.angle = angle;
  state.speed = speed;
  return state;
}

function pose(vehicle: Pick<VehicleState, 'x' | 'y' | 'angle' | 'speed'>) {
  return {
    x: vehicle.x,
    y: vehicle.y,
    angle: vehicle.angle,
    speed: vehicle.speed
  };
}

function snapshot(fixture: ReturnType<typeof contactFixture>) {
  return {
    alpha: pose(fixture.vehicles.alpha),
    bravo: pose(fixture.vehicles.bravo),
    alphaHealth: fixture.vehicles.alpha.health,
    bravoHealth: fixture.vehicles.bravo.health
  };
}

type VehicleId = 'alpha' | 'bravo';

import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {VehicleInputController} from '../server/game/vehicles/vehicle-input-controller.ts';

function fixture(): {state: DistrictState; controller: VehicleInputController; player: PlayerState} {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'driver';
  player.vehicleId = 'car';
  player.vehicleSeat = 0;
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.driverId = player.id;
  state.players.set(player.id, player);
  state.vehicles.set(vehicle.id, vehicle);
  return {state, controller: new VehicleInputController(state), player};
}

test('vehicle input queue consumes fixed moves in order and acknowledges only applied moves', () => {
  const {controller, player} = fixture();
  assert.equal(controller.accept(player.id, {
    vehicleId: 'car',
    moves: [
      {sequence: 1, x: 1, y: -1, handbrake: true},
      {sequence: 2, x: 0.5, y: -1}
    ]
  }), 2);
  assert.equal(player.lastVehicleInputSequence, 0, 'Receipt is not an applied-state acknowledgement.');
  const first = controller.consume(player.id, 'car');
  assert.deepEqual(first, {inputX: 1, inputY: -1, sequence: 1, handbrake: true});
  controller.acknowledge(player.id, 'car', first?.sequence ?? 0);
  assert.equal(player.lastVehicleInputSequence, 1);
  assert.deepEqual(controller.consume(player.id, 'car'), {inputX: 0.5, inputY: -1, sequence: 2});
});

test('vehicle input rejects stale, invalid-seat, and wrong-vehicle commands', () => {
  const {state, controller, player} = fixture();
  assert.equal(controller.accept(player.id, {
    vehicleId: 'other',
    moves: [{sequence: 1, x: 0, y: -1}]
  }), 0);
  player.vehicleSeat = 1;
  assert.equal(controller.accept(player.id, {
    vehicleId: 'car',
    moves: [{sequence: 1, x: 0, y: -1}]
  }), 0);
  player.vehicleSeat = 0;
  assert.equal(controller.accept(player.id, {
    vehicleId: 'car',
    moves: [{sequence: 1, x: 0, y: -1}, {sequence: 1, x: 1, y: 0}]
  }), 1);
  state.vehicles.get('car')!.driverId = 'someone-else';
  assert.equal(controller.accept(player.id, {
    vehicleId: 'car',
    moves: [{sequence: 2, x: 0, y: -1}]
  }), 0);
});

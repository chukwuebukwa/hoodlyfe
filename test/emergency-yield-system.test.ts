import assert from 'node:assert/strict';
import test from 'node:test';
import {EmergencyYieldSystem} from '../server/game/traffic/emergency-yield-system.ts';
import {VehicleState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

const openRoad = {
  canOccupy: () => true,
  isRoadAt: () => true
} as unknown as CollisionMap;

test('same-direction civilian traffic pulls aside for a moving siren behind it', () => {
  const system = new EmergencyYieldSystem(openRoad);
  const runtime = system.createRuntime();
  const civilian = trafficVehicle();
  const command = system.command(civilian, runtime, [{
    id: 'cruiser', x: 0, y: 0, angle: 0, speed: 140, siren: true, destroyed: false
  }], 100);
  assert.match(command.phase, /^yield-(left|right)$/);
  assert.equal(command.emergencyId, 'cruiser');
  assert.ok(command.targetX! > civilian.x);
  assert.notEqual(command.targetY, civilian.y);
  assert.equal(system.command(civilian, runtime, [], 500).phase, command.phase);
  assert.equal(system.command(civilian, runtime, [], 2_000).phase, 'none');
});

test('oncoming traffic waits while irrelevant emergency vehicles are ignored', () => {
  const system = new EmergencyYieldSystem(openRoad);
  const civilian = trafficVehicle();
  civilian.angle = Math.PI;
  assert.equal(system.command(civilian, system.createRuntime(), [{
    id: 'cruiser', x: 0, y: 0, angle: 0, speed: 140, siren: true, destroyed: false
  }], 100).phase, 'wait');
  const crossing = trafficVehicle();
  crossing.angle = Math.PI / 2;
  assert.equal(system.command(crossing, system.createRuntime(), [{
    id: 'cruiser', x: 0, y: 0, angle: 0, speed: 140, siren: true, destroyed: false
  }], 100).phase, 'wait');
  for (const emergency of [
    {id: 'silent', x: 0, y: 0, angle: 0, speed: 140, siren: false, destroyed: false},
    {id: 'stopped', x: 0, y: 0, angle: 0, speed: 0, siren: true, destroyed: false},
    {id: 'wreck', x: 0, y: 0, angle: 0, speed: 140, siren: true, destroyed: true},
    {id: 'behind', x: 300, y: 0, angle: 0, speed: 140, siren: true, destroyed: false}
  ]) {
    assert.equal(system.command(trafficVehicle(), system.createRuntime(), [emergency], 100).phase, 'none');
  }
});

test('yield falls back to waiting when neither road shoulder is safe', () => {
  const blocked = {
    canOccupy: () => false,
    isRoadAt: () => true
  } as unknown as CollisionMap;
  const system = new EmergencyYieldSystem(blocked);
  assert.equal(system.command(trafficVehicle(), system.createRuntime(), [{
    id: 'cruiser', x: 0, y: 0, angle: 0, speed: 140, siren: true, destroyed: false
  }], 100).phase, 'wait');
});

function trafficVehicle(): VehicleState {
  const vehicle = new VehicleState();
  vehicle.id = 'civilian';
  vehicle.x = 120;
  vehicle.y = 0;
  vehicle.angle = 0;
  vehicle.speed = 90;
  vehicle.traffic = true;
  return vehicle;
}

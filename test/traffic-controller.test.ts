import assert from 'node:assert/strict';
import test from 'node:test';
import {TrafficController} from '../server/game/traffic/traffic-controller.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('traffic controller follows deterministic road routes and releases hijacked cars', () => {
  const world = CollisionMap.load();
  const first = createTraffic(world, 'traffic-a', 211);
  const second = createTraffic(world, 'traffic-a', 211);
  const firstController = new TrafficController({
    world,
    random: new DeterministicRandom('traffic-scenario')
  });
  const secondController = new TrafficController({
    world,
    random: new DeterministicRandom('traffic-scenario')
  });
  firstController.register(first.vehicle.id, first.spawn, 118);
  secondController.register(second.vehicle.id, second.spawn, 118);

  for (let tick = 1; tick <= 120; tick++) {
    firstController.update(first.vehicle, 1 / 30, tick * 1000 / 30);
    secondController.update(second.vehicle, 1 / 30, tick * 1000 / 30);
  }
  assert.ok(Math.hypot(first.vehicle.x - first.spawn.x, first.vehicle.y - first.spawn.y) > 20);
  assert.equal(first.vehicle.x, second.vehicle.x);
  assert.equal(first.vehicle.y, second.vehicle.y);
  assert.equal(first.vehicle.angle, second.vehicle.angle);

  first.vehicle.hijackBy = 'player';
  const speedBeforeBraking = first.vehicle.speed;
  firstController.update(first.vehicle, 1 / 30, 5000);
  assert.ok(first.vehicle.speed < speedBeforeBraking);
  firstController.release(first.vehicle.id);
  const released = {x: first.vehicle.x, y: first.vehicle.y, speed: first.vehicle.speed};
  first.vehicle.hijackBy = '';
  firstController.update(first.vehicle, 1, 6000);
  assert.deepEqual({x: first.vehicle.x, y: first.vehicle.y, speed: first.vehicle.speed}, released);
});

function createTraffic(world: CollisionMap, id: string, seed: number) {
  const spawn = world.trafficSpawn(seed, 20);
  const vehicle = new VehicleState();
  vehicle.id = id;
  vehicle.x = spawn.x;
  vehicle.y = spawn.y;
  vehicle.angle = spawn.angle;
  vehicle.speed = 90;
  vehicle.traffic = true;
  return {vehicle, spawn};
}

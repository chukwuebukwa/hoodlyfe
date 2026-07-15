import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TrafficAwarenessSystem,
  type TrafficAwarenessInput,
  type TrafficObstacle
} from '../server/game/traffic/traffic-awareness-system.ts';

test('traffic awareness preserves cruise speed for irrelevant obstacles', () => {
  const system = new TrafficAwarenessSystem();
  const result = system.evaluate(input([
    obstacle('behind', -40, 0),
    obstacle('other-lane', 70, 80),
    obstacle('far', 400, 0)
  ]));
  assert.equal(result.reason, 'cruise');
  assert.equal(result.desiredSpeed, 120);
  assert.equal(result.obstacleId, '');
});

test('traffic awareness follows lead cars and stops for pedestrians in its corridor', () => {
  const system = new TrafficAwarenessSystem();
  const following = system.evaluate(input([
    obstacle('lead', 75, 0, 'vehicle', 35)
  ]));
  assert.equal(following.reason, 'vehicle');
  assert.equal(following.obstacleId, 'lead');
  assert.ok(following.desiredSpeed < 120);
  assert.ok(following.desiredSpeed >= 0);

  const pedestrian = system.evaluate(input([
    obstacle('walker', 65, 0, 'pedestrian')
  ]));
  assert.equal(pedestrian.reason, 'pedestrian');
  assert.equal(pedestrian.desiredSpeed, 0);
  assert.equal(pedestrian.obstacleDistance, 34);
});

test('traffic awareness selects the most restrictive obstacle deterministically', () => {
  const system = new TrafficAwarenessSystem();
  const obstacles = [
    obstacle('far-car', 100, 0, 'vehicle', 60),
    obstacle('near-car', 68, 0, 'vehicle', 0)
  ];
  const first = system.evaluate(input(obstacles));
  const second = system.evaluate(input([...obstacles].reverse()));
  assert.deepEqual(first, second);
  assert.equal(first.obstacleId, 'near-car');
});

test('traffic awareness brakes for an oriented vehicle crossing outside the old circle corridor', () => {
  const system = new TrafficAwarenessSystem();
  const crossing = obstacle('crossing-car', 80, -90, 'vehicle', 100);
  crossing.angle = Math.PI / 2;
  const result = system.evaluate(input([crossing]));

  assert.equal(result.reason, 'vehicle');
  assert.equal(result.obstacleId, 'crossing-car');
  assert.ok(result.timeToContactSeconds >= 0);
  assert.ok(result.desiredSpeed < 120);
});

test('traffic awareness does not brake for a vehicle moving in a clear adjacent lane', () => {
  const system = new TrafficAwarenessSystem();
  const adjacent = obstacle('adjacent-car', 30, 40, 'vehicle', 60);
  const result = system.evaluate(input([adjacent]));

  assert.equal(result.reason, 'cruise');
  assert.equal(result.timeToContactSeconds, -1);
});

function input(obstacles: TrafficObstacle[]): TrafficAwarenessInput {
  return {
    vehicleId: 'ego',
    x: 0,
    y: 0,
    angle: 0,
    bodyAngle: 0,
    speed: 120,
    radius: 20,
    halfLength: 29,
    halfWidth: 16,
    cruiseSpeed: 120,
    brakeDeceleration: 300,
    minimumGap: 28,
    followingTime: 0.6,
    pedestrianGap: 38,
    lookAhead: 260,
    obstacles
  };
}

function obstacle(
  id: string,
  x: number,
  y: number,
  kind: TrafficObstacle['kind'] = 'vehicle',
  speed = 0
): TrafficObstacle {
  return {
    id,
    kind,
    x,
    y,
    radius: kind === 'vehicle' ? 20 : 11,
    speed,
    angle: 0,
    ...(kind === 'vehicle' ? {halfLength: 29, halfWidth: 16} : {})
  };
}

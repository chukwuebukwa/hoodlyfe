import assert from 'node:assert/strict';
import test from 'node:test';
import {PoliceVehicleController} from '../server/game/police/police-vehicle-controller.ts';
import {
  policeVehicleStrategy,
  predictPoliceDestination
} from '../server/game/police/police-vehicle-policy.ts';
import type {PoliceVehicleTargetSnapshot} from '../server/game/police/crime-response-controller.ts';
import {VehicleState} from '../server/state.ts';
import type {CollisionMap, RoadNode} from '../server/world-map.ts';

test('police cruiser searches a reported location without tracking an unseen live target', () => {
  let lineOfSight = false;
  const world = createRoadWorld(() => lineOfSight);
  let target = createTarget({
    reportedX: 288,
    currentX: 608,
    wantedLevel: 2
  });
  const controller = new PoliceVehicleController({
    world,
    targetFor: () => target,
    forgetTarget() {}
  });
  const vehicle = createPoliceVehicle();
  controller.register(vehicle.id);

  controller.update(vehicle, 1 / 30, 0);
  let diagnostic = controller.diagnostics()[0];
  assert.equal(vehicle.siren, true);
  assert.equal(diagnostic.strategy, 'search');
  assert.equal(diagnostic.canSeeTarget, false);
  assert.equal(diagnostic.lastKnownX, 288);
  assert.ok(diagnostic.waypoints.length > 0);
  assert.ok(diagnostic.waypoints.at(-1)!.x <= 288);

  for (let tick = 1; tick <= 60; tick++) {
    controller.update(vehicle, 1 / 30, tick * 1000 / 30);
  }
  assert.ok(vehicle.x > 32, `Expected cruiser to move toward report, got ${vehicle.x}.`);

  lineOfSight = true;
  target = createTarget({
    reportedX: 288,
    currentX: vehicle.x + 160,
    wantedLevel: 3,
    targetVehicleId: 'getaway-car',
    currentSpeed: 180
  });
  controller.update(vehicle, 1 / 30, 2200, [{
    id: 'getaway-car',
    kind: 'vehicle',
    x: target.currentX,
    y: target.currentY,
    radius: 20,
    speed: target.currentSpeed,
    angle: target.currentAngle
  }]);
  diagnostic = controller.diagnostics()[0];
  assert.equal(diagnostic.strategy, 'ram');
  assert.equal(diagnostic.canSeeTarget, true);
  assert.equal(diagnostic.lastKnownX, target.currentX);
  assert.ok(diagnostic.desiredSpeed >= 250);
});

test('police cruiser forgets an expired report and yields immediately to hijacking', () => {
  const world = createRoadWorld(() => false);
  const target = createTarget({reportedX: 224, currentX: 544, wantedLevel: 1});
  let ignoredReportAt = -1;
  const controller = new PoliceVehicleController({
    world,
    targetFor: () => target.reportedAt > ignoredReportAt ? target : undefined,
    forgetTarget: (_vehicleId, _suspectId, reportedAt) => {
      ignoredReportAt = Math.max(ignoredReportAt, reportedAt);
    }
  });
  const vehicle = createPoliceVehicle();
  controller.register(vehicle.id);

  controller.update(vehicle, 1 / 30, 0);
  controller.update(vehicle, 1 / 30, 9001);
  assert.equal(controller.diagnostics()[0].strategy, 'idle');
  assert.equal(controller.diagnostics()[0].suspectId, '');
  assert.equal(vehicle.siren, false);

  target.reportedAt = 10_000;
  controller.update(vehicle, 1 / 30, 10_000);
  assert.equal(vehicle.siren, true);
  vehicle.hijackBy = 'player-1';
  const speedBeforeHijack = vehicle.speed;
  controller.update(vehicle, 1 / 30, 10_100);
  assert.equal(controller.diagnostics()[0].strategy, 'hijack');
  assert.equal(vehicle.siren, false);
  assert.ok(vehicle.speed <= speedBeforeHijack);
});

test('secondary cruisers intercept flanks without inheriting primary ram behavior', () => {
  const target = createTarget({
    wantedLevel: 4,
    currentX: 200,
    currentY: 300,
    currentAngle: 0,
    currentSpeed: 100,
    targetVehicleId: 'getaway-car',
    tacticalRole: 'intercept-left'
  });

  assert.equal(policeVehicleStrategy(target, 'pursuit', 80), 'intercept');
  assert.deepEqual(predictPoliceDestination(target, 10, 20, true), {
    x: 360,
    y: 378
  });
  target.targetVehicleId = '';
  assert.equal(policeVehicleStrategy(target, 'pursuit', 80), 'contain');
  assert.deepEqual(predictPoliceDestination(target, 10, 20, true), {
    x: 310,
    y: 378
  });
  assert.deepEqual(predictPoliceDestination(target, 10, 20, false), {x: 10, y: 20});
});

function createTarget(
  overrides: Partial<PoliceVehicleTargetSnapshot> = {}
): PoliceVehicleTargetSnapshot {
  return {
    suspectId: 'suspect-1',
    wantedLevel: 1,
    reportedX: 224,
    reportedY: 32,
    reportedAt: 0,
    currentX: 224,
    currentY: 32,
    currentAngle: 0,
    currentSpeed: 0,
    targetVehicleId: '',
    tacticalRole: 'primary',
    ...overrides
  };
}

function createPoliceVehicle(): VehicleState {
  const vehicle = new VehicleState();
  vehicle.id = 'police-cruiser-1';
  vehicle.kind = 'police';
  vehicle.x = 32;
  vehicle.y = 32;
  vehicle.angle = 0;
  return vehicle;
}

function createRoadWorld(hasLineOfSight: () => boolean): CollisionMap {
  return {
    tileWidth: 64,
    tileHeight: 64,
    roadNeighbors(column: number, row: number): RoadNode[] {
      const neighbors: RoadNode[] = [];
      if (column > 0) neighbors.push({column: column - 1, row});
      if (column < 12) neighbors.push({column: column + 1, row});
      return neighbors;
    },
    roadPoint(node: RoadNode) {
      return {x: (node.column + 0.5) * 64, y: (node.row + 0.5) * 64};
    },
    nearestRoadNode(x: number, y: number) {
      return {column: Math.max(0, Math.min(12, Math.floor(x / 64))), row: Math.floor(y / 64)};
    },
    canOccupy: () => true,
    isRoadAt: () => true,
    hasLineOfSight
  } as unknown as CollisionMap;
}

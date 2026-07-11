import assert from 'node:assert/strict';
import test from 'node:test';
import {PoliceVehicleDispatchSystem} from '../server/game/police/police-vehicle-dispatch-system.ts';
import type {PoliceVehicleTargetSnapshot} from '../server/game/police/crime-response-controller.ts';

test('cruiser dispatch prioritizes heat, preserves assignments, and respects response caps', () => {
  const dispatch = new PoliceVehicleDispatchSystem();
  const lowHeat = target('low', 1, 40);
  const highHeat = target('high', 3, 400);

  assert.equal(dispatch.targetFor('unit-1', 0, 0, [lowHeat, highHeat])?.suspectId, 'high');
  assert.equal(dispatch.targetFor('unit-1', 900, 0, [lowHeat, highHeat])?.suspectId, 'high');
  assert.equal(dispatch.targetFor('unit-2', 0, 0, [lowHeat])?.suspectId, 'low');
  assert.equal(dispatch.targetFor('unit-3', 0, 0, [lowHeat]), undefined);
});

test('cruiser dispatch does not reuse an expired report until a newer report arrives', () => {
  const dispatch = new PoliceVehicleDispatchSystem();
  const firstReport = target('suspect', 2, 100, 500);
  assert.equal(dispatch.targetFor('unit-1', 0, 0, [firstReport])?.suspectId, 'suspect');

  dispatch.forget('unit-1', 'suspect', firstReport.reportedAt);
  assert.equal(dispatch.targetFor('unit-1', 0, 0, [firstReport]), undefined);
  const newerReport = {...firstReport, reportedAt: 900};
  assert.equal(dispatch.targetFor('unit-1', 0, 0, [newerReport])?.reportedAt, 900);
});

function target(
  suspectId: string,
  wantedLevel: number,
  reportedX: number,
  reportedAt = 100
): PoliceVehicleTargetSnapshot {
  return {
    suspectId,
    wantedLevel,
    reportedX,
    reportedY: 0,
    reportedAt,
    currentX: reportedX,
    currentY: 0,
    currentAngle: 0,
    currentSpeed: 0,
    targetVehicleId: ''
  };
}

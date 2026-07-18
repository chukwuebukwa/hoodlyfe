import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POLICE_STINGER_SEGMENT_COUNT,
  policeStingerBurstMask,
  policeStingerSegmentPositions,
  vehicleWheelPositions
} from '../shared/simulation/police-stinger-contact.ts';
import {VEHICLE_TYRE, VEHICLE_TYRE_MASK} from '../shared/simulation/vehicle-tyre-state.ts';

test('authored stinger expands into twelve stable contiguous segments', () => {
  const segments = policeStingerSegmentPositions({
    x: 100,
    y: 200,
    angle: Math.PI / 2,
    activeSegmentCount: POLICE_STINGER_SEGMENT_COUNT
  });
  assert.equal(segments.length, 12);
  assert.ok(segments[0].y < 200);
  assert.ok(segments.at(-1)!.y > 200);
  assert.ok(segments.every((segment) => Math.abs(segment.x - 100) < 1e-9));
});

test('swept wheel contact catches a fast vehicle crossing the full strip', () => {
  const mask = policeStingerBurstMask({
    x: 0,
    y: 0,
    angle: Math.PI / 2,
    activeSegmentCount: 12
  }, {
    x: -80,
    y: 0,
    angle: 0
  }, {
    x: 80,
    y: 0,
    angle: 0
  }, 'sedan');
  assert.equal(mask, VEHICLE_TYRE_MASK.all);
});

test('partial strip crossing bursts only the axle whose wheel paths made contact', () => {
  const mask = policeStingerBurstMask({
    x: 0,
    y: 0,
    angle: Math.PI / 2,
    activeSegmentCount: 12
  }, {
    x: -40,
    y: 0,
    angle: 0
  }, {
    x: -10,
    y: 0,
    angle: 0
  }, 'sedan');
  assert.equal(mask, VEHICLE_TYRE.frontLeft | VEHICLE_TYRE.frontRight);
});

test('wheel contact preserves existing burst state and ignores a geometric miss', () => {
  const stinger = {x: 0, y: 0, angle: Math.PI / 2, activeSegmentCount: 12};
  const hit = policeStingerBurstMask(
    stinger,
    {x: -80, y: 0, angle: 0},
    {x: 80, y: 0, angle: 0},
    'sedan',
    VEHICLE_TYRE.frontLeft
  );
  assert.equal(hit & VEHICLE_TYRE.frontLeft, 0);
  assert.notEqual(hit, 0);
  assert.equal(policeStingerBurstMask(
    stinger,
    {x: -80, y: 100, angle: 0},
    {x: 80, y: 100, angle: 0},
    'sedan'
  ), 0);
});

test('wheel positions retain exact tyre identities around an oriented vehicle', () => {
  const wheels = vehicleWheelPositions({x: 10, y: 20, angle: 0}, 'sedan');
  assert.deepEqual(wheels.map(({tyre}) => tyre), [
    VEHICLE_TYRE.frontLeft,
    VEHICLE_TYRE.rearLeft,
    VEHICLE_TYRE.frontRight,
    VEHICLE_TYRE.rearRight
  ]);
  assert.ok(wheels[0].x > wheels[1].x);
  assert.ok(wheels[0].y < wheels[2].y);
});

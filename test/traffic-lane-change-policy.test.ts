import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planTrafficLaneChange,
  type TrafficLaneChangeVehicle
} from '../server/game/traffic/traffic-lane-change-policy.ts';
import type {TrafficObstacle} from '../server/game/traffic/traffic-awareness-system.ts';
import type {TrafficLaneSegment} from '../server/game/traffic/traffic-route-system.ts';

const openRoad = {
  canOccupy: () => true,
  isRoadAt: () => true
};

test('lane-change policy builds an authored adjacent-lane pass and return trajectory', () => {
  const result = planTrafficLaneChange({
    vehicle: vehicle(),
    segment: segment(),
    lead: lead(),
    obstacles: [lead()],
    world: openRoad
  });

  assert.equal(result.rejectReason, 'none');
  assert.ok(result.plan);
  assert.equal(result.plan.leadId, 'lead');
  assert.equal(result.plan.fromLaneIndex, 0);
  assert.equal(result.plan.toLaneIndex, 1);
  assert.equal(result.plan.entryY, 40);
  assert.equal(result.plan.passY, 40);
  assert.equal(result.plan.returnY, 0);
  assert.ok(result.plan.entryX > 100);
  assert.ok(result.plan.passX > result.plan.entryX);
  assert.ok(result.plan.returnX > result.plan.passX);
});

test('lane-change policy rejects an unsafe fast-closing rear gap', () => {
  const closingRear: TrafficObstacle = {
    id: 'closing-rear',
    kind: 'vehicle',
    x: 70,
    y: 40,
    radius: 20,
    speed: 120,
    angle: 0,
    halfLength: 20,
    halfWidth: 10
  };
  const result = planTrafficLaneChange({
    vehicle: vehicle(),
    segment: segment(),
    lead: lead(),
    obstacles: [lead(), closingRear],
    world: openRoad
  });

  assert.equal(result.plan, undefined);
  assert.equal(result.rejectReason, 'target-rear-gap');
});

test('lane-change policy waits when there is not enough room to clear the lead', () => {
  const closeLead = lead();
  closeLead.x = 160;
  const result = planTrafficLaneChange({
    vehicle: vehicle(),
    segment: segment(),
    lead: closeLead,
    obstacles: [closeLead],
    world: openRoad
  });

  assert.equal(result.plan, undefined);
  assert.equal(result.rejectReason, 'lead-clearance');
});

test('lane-change policy preserves signal and pedestrian queues', () => {
  for (const kind of ['signal', 'pedestrian'] as const) {
    const protectedObstacle: TrafficObstacle = {
      id: kind,
      kind,
      x: 180,
      y: 40,
      radius: kind === 'pedestrian' ? 11 : 0
    };
    const result = planTrafficLaneChange({
      vehicle: vehicle(),
      segment: segment(),
      lead: lead(),
      obstacles: [lead(), protectedObstacle],
      world: openRoad
    });
    assert.equal(result.plan, undefined);
    assert.equal(result.rejectReason, kind === 'signal' ? 'target-signal' : 'target-pedestrian');
  }
});

test('lane-change policy refuses to begin a pass too close to a junction', () => {
  const shortSegment = segment();
  shortSegment.toX = 300;
  shortSegment.adjacent[0].toX = 300;
  const result = planTrafficLaneChange({
    vehicle: vehicle(),
    segment: shortSegment,
    lead: lead(),
    obstacles: [lead()],
    world: openRoad
  });

  assert.equal(result.plan, undefined);
  assert.equal(result.rejectReason, 'junction-near');
});

function vehicle(): TrafficLaneChangeVehicle {
  return {
    id: 'ego',
    x: 100,
    y: 0,
    speed: 20,
    halfLength: 20,
    halfWidth: 10
  };
}

function lead(): TrafficObstacle {
  return {
    id: 'lead',
    kind: 'vehicle',
    x: 220,
    y: 0,
    radius: 20,
    speed: 0,
    angle: 0,
    halfLength: 20,
    halfWidth: 10
  };
}

function segment(): TrafficLaneSegment {
  return {
    edgeId: 'road:forward:edge:0',
    corridorId: 'road',
    direction: 'forward',
    laneIndex: 0,
    laneCount: 2,
    fromX: 0,
    fromY: 0,
    toX: 600,
    toY: 0,
    adjacent: [{
      edgeId: 'road:forward:lane-1:edge:0',
      laneIndex: 1,
      fromX: 0,
      fromY: 40,
      toX: 600,
      toY: 40
    }]
  };
}

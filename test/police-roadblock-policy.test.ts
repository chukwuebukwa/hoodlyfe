import assert from 'node:assert/strict';
import test from 'node:test';
import type {LaneRoadblockDefinition} from '../server/game/traffic/lane-graph.ts';
import {
  roadblockCooldownMs,
  roadblockEligible,
  selectRoadblockOpportunity,
  type PoliceRoadblockSuspect
} from '../server/game/police/police-roadblock-policy.ts';

const movingSuspect: PoliceRoadblockSuspect = {
  id: 'suspect',
  wantedLevel: 3,
  x: 0,
  y: 0,
  angle: 0,
  speed: 80,
  inVehicle: true
};

test('roadblock eligibility requires enough heat and a moving vehicle', () => {
  assert.equal(roadblockEligible(movingSuspect), true);
  assert.equal(roadblockEligible({...movingSuspect, wantedLevel: 2}), false);
  assert.equal(roadblockEligible({...movingSuspect, inVehicle: false}), false);
  assert.equal(roadblockEligible({...movingSuspect, speed: 20}), false);
  assert.equal(roadblockEligible({...movingSuspect, speed: -60}), true);
});

test('roadblock selection is deterministic and chooses an authored opportunity ahead', () => {
  const opportunities = [
    opportunity('behind', -1_000, 0),
    opportunity('too-close', 300, 0),
    opportunity('ahead-far', 1_450, 0),
    opportunity('ahead-preferred-b', 1_080, 40),
    opportunity('ahead-preferred-a', 1_080, -40)
  ];

  assert.equal(selectRoadblockOpportunity(movingSuspect, opportunities)?.id, 'ahead-preferred-a');
  assert.equal(selectRoadblockOpportunity({...movingSuspect, speed: -80}, opportunities)?.id, 'behind');
  assert.equal(selectRoadblockOpportunity({...movingSuspect, wantedLevel: 1}, opportunities), undefined);
});

test('roadblock cooldown contracts as wanted pressure rises', () => {
  assert.equal(roadblockCooldownMs(3), 28_000);
  assert.equal(roadblockCooldownMs(4), 20_000);
  assert.equal(roadblockCooldownMs(5), 14_000);
});

function opportunity(id: string, x: number, y: number): LaneRoadblockDefinition {
  return {
    id,
    x,
    y,
    angle: 0,
    blockedEdgeIds: [`${id}:edge`],
    vehiclePoses: [],
    stinger: {x, y, angle: 0, officerPose: {x, y, angle: 0}}
  };
}

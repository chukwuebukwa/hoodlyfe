import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrateOnFootPose,
  ON_FOOT_SIMULATION_STEP_SECONDS,
  onFootMovementScale,
  stepInteriorOnFootPose
} from '../shared/simulation/on-foot-step.ts';
import {PlayerControlController} from '../server/game/players/player-control-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('shared on-foot step preserves analog input and caps diagonal speed', () => {
  const canOccupy = () => true;
  const half = stepInteriorOnFootPose(
    {x: 10, y: 20, spaceId: 'street'},
    {moveX: 0.5, moveY: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    canOccupy
  );
  const diagonal = stepInteriorOnFootPose(
    {x: 10, y: 20, spaceId: 'street'},
    {moveX: 1, moveY: 1},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    canOccupy
  );
  assert.ok(Math.abs(half.distance - 190 * 0.5 / 30) < 1e-9);
  assert.ok(Math.abs(diagonal.distance - 190 / 30) < 1e-9);
});

test('shared on-foot step resolves each world collision axis independently', () => {
  const result = stepInteriorOnFootPose(
    {x: 100, y: 100, spaceId: 'street'},
    {moveX: 1, moveY: 1},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    (_spaceId, x) => x <= 100
  );
  assert.equal(result.pose.x, 100);
  assert.ok(result.pose.y > 100);
  assert.equal(result.collidedX, true);
  assert.equal(result.collidedY, false);
});

test('shared on-foot step retains an authoritative surface transition', () => {
  const result = stepInteriorOnFootPose(
    {x: 100, y: 100, spaceId: 'street', surfaceId: 'street-ground'},
    {moveX: 1, moveY: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    () => 'bridge'
  );
  assert.equal(result.pose.surfaceId, 'bridge');
});

test('on-foot action policy keeps melee locomotion and gates other actions', () => {
  assert.equal(onFootMovementScale('', 'pistol', 0), 1);
  assert.equal(onFootMovementScale('entering', 'pistol', 0), 0);
  assert.equal(onFootMovementScale('melee', 'pistol', 0), 0);
  assert.equal(onFootMovementScale('melee', 'fists', 0), 1);
});

test('authoritative controller and shared step remain identical over 10,000 ticks', () => {
  const state = new DistrictState();
  const world = {canOccupy: (x: number, y: number) => (
    x >= 24 && y >= 24 && x <= 1_000 && y <= 1_000 && !(x > 450 && x < 510 && y < 700)
  )} as unknown as CollisionMap;
  const controller = new PlayerControlController({state, world});
  const player = new PlayerState();
  player.id = 'parity';
  player.x = 120;
  player.y = 140;
  state.players.set(player.id, player);
  controller.register(player.id);
  let expected = {x: player.x, y: player.y, spaceId: 'street'};
  for (let tick = 1; tick <= 10_000; tick++) {
    const x = Math.sin(tick * 0.071) * 1.2;
    const y = Math.cos(tick * 0.047) * 1.2;
    controller.setMove(player.id, {x, y, sequence: tick});
    controller.updateOnFoot(player, ON_FOOT_SIMULATION_STEP_SECONDS);
    expected = integrateOnFootPose(
      expected,
      {moveX: x, moveY: y},
      ON_FOOT_SIMULATION_STEP_SECONDS
    );
    assert.deepEqual(
      {x: player.x, y: player.y, spaceId: player.spaceId},
      expected,
      `On-foot divergence at tick ${tick}`
    );
  }
  assert.equal(player.lastInputSequence, 10_000);
});

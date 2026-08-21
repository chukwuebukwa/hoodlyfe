import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ON_FOOT_PLAYER_SPEED,
  ON_FOOT_SIMULATION_STEP_SECONDS,
  integrateOnFootPose
} from '../shared/simulation/on-foot-step.ts';
import {
  OnFootPredictionController,
  type OnFootPredictionAuthority,
  type OnFootPredictionWorld
} from '../src/game/network/on-foot-prediction-controller.ts';

const world: OnFootPredictionWorld = {
  step: (pose, movement, movementScale) => integrateOnFootPose(
    pose,
    {moveX: movement.x, moveY: movement.y},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    {movementScale}
  )
};

test('on-foot prediction advances immediately and emits ordered fixed-step input', () => {
  const controller = new OnFootPredictionController(world);
  const batch = controller.update(
    authority(),
    {x: 1, y: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    true
  );
  assert.deepEqual(batch, {moves: [{sequence: 1, x: 1, y: 0}]});
  assert.ok((controller.pose()?.x ?? 0) > 100);
  assert.deepEqual(controller.snapshot(), {
    active: true,
    sequence: 1,
    acknowledgedSequence: 0,
    pendingInputs: 1,
    historyCapacity: 192,
    historyMilliseconds: 3200,
    replayedInputs: 0,
    correctionErrorPx: 0,
    corrections: 0,
    resets: 0,
    reason: 'predicting'
  });
});

test('prediction retains the previous 3.2s saved-input acknowledgement tolerance', () => {
  const controller = new OnFootPredictionController(world);
  const delayedTicks = Math.floor(3.1 / ON_FOOT_SIMULATION_STEP_SECONDS);
  for (let index = 0; index < delayedTicks; index++) {
    controller.update(
      authority(),
      {x: 1, y: 0},
      ON_FOOT_SIMULATION_STEP_SECONDS,
      true
    );
  }
  const step = ON_FOOT_PLAYER_SPEED * ON_FOOT_SIMULATION_STEP_SECONDS;
  controller.update(
    authority({x: 100 + step, lastInputSequence: 1}),
    {x: 0, y: 0},
    0,
    true
  );

  const snapshot = controller.snapshot();
  assert.equal(snapshot.resets, 0);
  assert.equal(snapshot.reason, 'predicting');
  assert.equal(snapshot.acknowledgedSequence, 1);
  assert.equal(snapshot.pendingInputs, delayedTicks - 1);
  assert.equal(snapshot.historyMilliseconds, 3200);
});

test('sub-pixel acknowledgement drift does not resimulate pending inputs', () => {
  const controller = new OnFootPredictionController(world);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  const step = ON_FOOT_PLAYER_SPEED * ON_FOOT_SIMULATION_STEP_SECONDS;
  const before = controller.pose();

  controller.update(
    authority({x: 100 + step - 0.5, lastInputSequence: 1}),
    {x: 0, y: 0},
    0,
    true
  );

  assert.deepEqual(controller.pose(), before);
  assert.equal(controller.snapshot().replayedInputs, 0);
  assert.equal(controller.snapshot().pendingInputs, 1);
  assert.equal(controller.snapshot().correctionErrorPx, 0.5);
});

test('exact authoritative acknowledgement removes confirmed input without replay', () => {
  const controller = new OnFootPredictionController(world);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  const firstStepX = 100 + ON_FOOT_PLAYER_SPEED * ON_FOOT_SIMULATION_STEP_SECONDS;
  controller.update(
    authority({x: firstStepX, lastInputSequence: 1}),
    {x: 0, y: 0},
    0,
    true
  );
  assert.equal(controller.snapshot().acknowledgedSequence, 1);
  assert.equal(controller.snapshot().pendingInputs, 1);
  assert.equal(controller.snapshot().replayedInputs, 0);
  assert.ok(Math.abs((controller.pose()?.x ?? 0) - (firstStepX * 2 - 100)) < 0.001);
});

test('small corrections preserve the rendered pose and decay without changing canonical replay', () => {
  const controller = new OnFootPredictionController(world);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  const before = controller.pose()?.x ?? 0;
  controller.update(
    authority({x: 101, lastInputSequence: 1}),
    {x: 0, y: 0},
    0,
    true
  );
  assert.ok(Math.abs((controller.pose()?.x ?? 0) - before) < 0.001);
  assert.ok(controller.snapshot().correctionErrorPx > 0);
  controller.update(
    authority({x: 101, lastInputSequence: 1}),
    {x: 0, y: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    true
  );
  assert.ok((controller.pose()?.x ?? 0) < before);
  assert.ok((controller.pose()?.x ?? 0) > 101);
});

test('unchanged acknowledgements do not reapply repeated server-held movement', () => {
  const controller = new OnFootPredictionController(world);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  const before = controller.pose();

  controller.update(
    authority({x: 104, lastInputSequence: 0}),
    {x: 0, y: 0},
    0,
    true
  );

  assert.deepEqual(controller.pose(), before);
  assert.equal(controller.snapshot().corrections, 0);
  assert.equal(controller.snapshot().replayedInputs, 0);
});

test('reconciliation refreshes pending snapshots for later acknowledgements', () => {
  const controller = new OnFootPredictionController(world);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  const step = ON_FOOT_PLAYER_SPEED * ON_FOOT_SIMULATION_STEP_SECONDS;

  controller.update(
    authority({x: 100 + step - 2, lastInputSequence: 1}),
    {x: 0, y: 0},
    0,
    true
  );
  assert.equal(controller.snapshot().corrections, 1);

  controller.update(
    authority({x: 100 + step * 2 - 2, lastInputSequence: 2}),
    {x: 0, y: 0},
    0,
    true
  );
  assert.equal(controller.snapshot().correctionErrorPx, 0);
  assert.equal(controller.snapshot().corrections, 1);
});

test('prediction fails closed when rollout is disabled or surface authority is missing', () => {
  const controller = new OnFootPredictionController(world);
  assert.equal(controller.update(
    authority(),
    {x: 1, y: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    false
  ), undefined);
  assert.equal(controller.snapshot().reason, 'rollout-disabled');
  controller.update(
    authority({surfaceId: undefined}),
    {x: 1, y: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    true
  );
  assert.equal(controller.snapshot().reason, 'missing-surface');
});

test('prediction fails closed when the player enters a vehicle', () => {
  const controller = new OnFootPredictionController(world);
  controller.update(authority(), {x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, true);
  assert.equal(controller.snapshot().active, true);
  controller.update(authority({vehicleId: 'car-1'}), {x: 1, y: 0}, 0, true);
  assert.equal(controller.snapshot().active, false);
  assert.equal(controller.snapshot().reason, 'vehicle-authority');
  assert.equal(controller.snapshot().resets, 1);
});

function authority(
  overrides: Partial<OnFootPredictionAuthority> = {}
): OnFootPredictionAuthority {
  return {
    x: 100,
    y: 200,
    spaceId: 'street',
    surfaceId: 'street-ground',
    alive: true,
    vehicleId: '',
    airborne: false,
    action: '',
    weapon: 'fists',
    attackCombo: 0,
    lastInputSequence: 0,
    ...overrides
  };
}

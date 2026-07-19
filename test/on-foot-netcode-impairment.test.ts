import assert from 'node:assert/strict';
import test from 'node:test';
import type {OnFootInputMoveMessage} from '../shared/protocol/on-foot-input.ts';
import {
  ON_FOOT_SIMULATION_STEP_SECONDS,
  type OnFootPose
} from '../shared/simulation/on-foot-step.ts';
import {initializePhysicsEngine, PhysicsWorld} from '../shared/physics/physics-world.ts';
import {SavedOnFootPrediction} from '../src/game/prediction/saved-on-foot-prediction.ts';
import {createHumanoidPhysicsPoseStepper} from '../src/game/prediction/vehicle-physics-replay.ts';
import {
  DeterministicReliableNetworkLink,
  NETWORK_IMPAIRMENT_PROFILES,
  type NetworkImpairmentProfile
} from './support/deterministic-network-link.ts';

interface OnFootBaseline {
  pose: OnFootPose;
  acknowledgedSequence: number;
}

interface OnFootImpairmentRun {
  profile: NetworkImpairmentProfile;
  errorP95: number;
  maximumError: number;
  maximumPendingMoves: number;
  hardCorrections: number;
  resimulations: number;
  maximumPredictedX: number;
}

const STEP_MS = ON_FOOT_SIMULATION_STEP_SECONDS * 1_000;
const TOTAL_TICKS = 360;
const WALL_EDGE_X = 220;

await initializePhysicsEngine();

test('saved on-foot prediction remains collision-safe under repeatable impairment', (context) => {
  const runs = NETWORK_IMPAIRMENT_PROFILES.map((profile, index) => runProfile(profile, index));
  for (const run of runs) {
    context.diagnostic(
      `${run.profile.id}: p95=${run.errorP95.toFixed(2)}px ` +
      `max=${run.maximumError.toFixed(2)}px pending=${run.maximumPendingMoves} ` +
      `resim=${run.resimulations}`
    );
    assert.equal(run.hardCorrections, 0, `${run.profile.id} exhausted on-foot history.`);
    assert.ok(run.maximumPendingMoves <= 24, `${run.profile.id} exceeded 800 ms of history.`);
    assert.ok(run.errorP95 < 70, `${run.profile.id} correction pressure is too high.`);
    assert.ok(run.maximumError < 120, `${run.profile.id} reached hard-correction distance.`);
    assert.ok(
      run.maximumPredictedX <= WALL_EDGE_X - 11 + 0.2,
      `Prediction crossed the wall at ${run.maximumPredictedX}.`
    );
  }
  assert.equal(runs[0].errorP95, 0);
  assert.ok(runs.at(-1)!.maximumPendingMoves > runs[0].maximumPendingMoves);
});

function runProfile(profile: NetworkImpairmentProfile, seed: number): OnFootImpairmentRun {
  const clientWorld = PhysicsWorld.create(geometry());
  const serverWorld = PhysicsWorld.create(geometry());
  const clientStep = createHumanoidPhysicsPoseStepper(() => clientWorld, 'local');
  const serverStep = createHumanoidPhysicsPoseStepper(() => serverWorld, 'local');
  const commands = new DeterministicReliableNetworkLink<OnFootInputMoveMessage>(
    profile,
    0x310000 + seed
  );
  const snapshots = new DeterministicReliableNetworkLink<OnFootBaseline>(
    profile,
    0x420000 + seed
  );
  const prediction = new SavedOnFootPrediction(clientStep);
  const initial = {x: 100, y: 100, spaceId: 'street'};
  prediction.initialize(initial);
  let authoritative = {...initial};
  let held: OnFootInputMoveMessage = {sequence: 0, x: 0, y: 0};
  const pending: OnFootInputMoveMessage[] = [];
  const errors: number[] = [];
  let maximumPendingMoves = 0;
  let hardCorrections = 0;
  let resimulations = 0;
  let maximumPredictedX = initial.x;

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    const nowMs = tick * STEP_MS;
    const movement = scriptedMovement(tick);
    const advanced = prediction.advance(
      movement,
      ON_FOOT_SIMULATION_STEP_SECONDS,
      canOccupy
    );
    maximumPredictedX = Math.max(maximumPredictedX, advanced.pose.x);
    for (const move of advanced.outboundMoves) commands.send(nowMs, move);
    pending.push(...commands.receive(nowMs));
    const applied = pending.shift();
    if (applied) held = applied;
    authoritative = serverStep(
      authoritative,
      {moveX: held.x, moveY: held.y},
      ON_FOOT_SIMULATION_STEP_SECONDS,
      canOccupy,
      {}
    );
    if (tick % 2 === 0) {
      snapshots.send(nowMs, {
        pose: {...authoritative},
        acknowledgedSequence: held.sequence
      });
    }
    for (const baseline of snapshots.receive(nowMs)) {
      const correction = prediction.reconcile(
        baseline.pose,
        baseline.acknowledgedSequence,
        canOccupy
      );
      errors.push(correction.positionError);
      maximumPendingMoves = Math.max(maximumPendingMoves, correction.pendingMoveCount);
      if (correction.hardCorrection) hardCorrections++;
      if (correction.resimulated) resimulations++;
      maximumPredictedX = Math.max(maximumPredictedX, correction.pose.x);
    }
  }
  errors.sort((left, right) => left - right);
  clientWorld.free();
  serverWorld.free();
  return {
    profile,
    errorP95: percentile(errors, 0.95),
    maximumError: errors.at(-1) ?? 0,
    maximumPendingMoves,
    hardCorrections,
    resimulations,
    maximumPredictedX
  };
}

function geometry() {
  const width = 25;
  const height = 25;
  const collisions = new Array(width * height).fill(0);
  for (let row = 0; row < height; row++) collisions[row * width + 11] = 1;
  return {width, height, tileWidth: 20, tileHeight: 20, collisions};
}

function canOccupy(_spaceId: string, x: number, y: number, radius: number): boolean {
  return x - radius >= 0 && y - radius >= 0 && x + radius <= WALL_EDGE_X && y + radius <= 500;
}

function scriptedMovement(tick: number): {x: number; y: number} {
  if (tick < 120) return {x: 1, y: 0};
  if (tick < 210) return {x: 0, y: 1};
  if (tick < 300) return {x: -1, y: 0};
  return {x: 0, y: 0};
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

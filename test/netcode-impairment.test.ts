import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERACTION_PROTOCOL_VERSION,
  validateInteractionSnapshot,
  validatePlayerInputCommand,
  type InteractionSnapshot,
  type PlayerInputCommand
} from '../shared/protocol/interaction-simulation.ts';
import {
  VEHICLE_SIMULATION_STEP_SECONDS,
  stepVehicleWithWorldCollision,
  type VehicleControlCommand,
  type VehicleStepResult
} from '../shared/simulation/vehicle-step.ts';
import {
  SavedVehiclePrediction,
  type VehiclePredictionCorrection
} from '../src/game/prediction/saved-vehicle-prediction.ts';
import type {MovementVector} from '../src/game/input/client-input-policy.ts';
import {
  NETWORK_IMPAIRMENT_PROFILES,
  DeterministicReliableNetworkLink,
  type NetworkImpairmentProfile
} from './support/deterministic-network-link.ts';

interface AuthoritativePacket {
  snapshot: InteractionSnapshot;
}

interface ImpairmentRun {
  profile: NetworkImpairmentProfile;
  corrections: number;
  resimulations: number;
  hardCorrections: number;
  errorP95: number;
  maximumError: number;
  maximumPendingMoves: number;
  commandRetransmissions: number;
  snapshotRetransmissions: number;
}

const STEP_MS = VEHICLE_SIMULATION_STEP_SECONDS * 1_000;
const TOTAL_TICKS = 360;
const SNAPSHOT_INTERVAL_TICKS = 2;
const WORLD_COLLISION_REVISION = 1;
const VEHICLE_ID = 'vehicle-local';

test('scripted driving remains bounded across repeatable WebSocket impairment profiles', (context) => {
  const runs = NETWORK_IMPAIRMENT_PROFILES.map((profile, index) => runProfile(profile, index));
  for (const run of runs) {
    context.diagnostic(
      `${run.profile.id}: p95=${run.errorP95.toFixed(2)}px max=${run.maximumError.toFixed(2)}px ` +
      `pending=${run.maximumPendingMoves} resim=${run.resimulations} ` +
      `retransmits=${run.commandRetransmissions + run.snapshotRetransmissions}`
    );
  }
  assert.equal(runs[0].errorP95, 0, JSON.stringify(runs));
  assert.equal(runs[0].hardCorrections, 0);
  for (const run of runs) {
    assert.equal(Number.isFinite(run.errorP95), true, run.profile.id);
    assert.equal(run.hardCorrections, 0, `${run.profile.id} should not exhaust retained history.`);
    assert.ok(run.maximumPendingMoves <= 24, `${run.profile.id} exceeded the 800 ms history target.`);
    assert.ok(run.errorP95 < 90, `${run.profile.id} p95 correction exceeded the M0 baseline.`);
    assert.ok(run.maximumError < 180, `${run.profile.id} reached hard-snap distance.`);
  }
  assert.ok(runs.at(-1)!.resimulations > runs[0].resimulations);
  assert.ok(runs.at(-1)!.maximumPendingMoves > runs[0].maximumPendingMoves);
});

test('impairment profiles are deterministic and model loss as ordered retransmission delay', () => {
  const profile = NETWORK_IMPAIRMENT_PROFILES.at(-1)!;
  assert.deepEqual(runProfile(profile, 77), runProfile(profile, 77));
  const run = runProfile(profile, 77);
  assert.ok(run.commandRetransmissions + run.snapshotRetransmissions > 0);
});

function runProfile(profile: NetworkImpairmentProfile, seed: number): ImpairmentRun {
  const commandLink = new DeterministicReliableNetworkLink<PlayerInputCommand>(
    profile,
    0xabc000 + seed
  );
  const snapshotLink = new DeterministicReliableNetworkLink<AuthoritativePacket>(
    profile,
    0xdef000 + seed
  );
  const prediction = new SavedVehiclePrediction();
  const initial = {x: 2_000, y: 2_000, angle: -Math.PI / 2, speed: 0};
  prediction.initialize(initial);
  let authoritative: VehicleStepResult = {
    pose: initial,
    attemptedPose: initial,
    impactSpeed: 0,
    collidedWithWorld: false,
    sweepSteps: 1
  };
  let serverSequence = 0;
  let held: VehicleControlCommand = {steering: 0, throttle: 0};
  let clientPose = {...initial};
  const errors: number[] = [];
  let corrections = 0;
  let resimulations = 0;
  let hardCorrections = 0;
  let maximumPendingMoves = 0;

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    const nowMs = tick * STEP_MS;
    const movement = scriptedMovement(tick);
    const advanced = prediction.advance(
      movement,
      'sedan',
      VEHICLE_SIMULATION_STEP_SECONDS,
      () => true
    );
    clientPose = advanced.pose;
    for (const move of advanced.outboundMoves) {
      const validated = validatePlayerInputCommand({
        protocolVersion: INTERACTION_PROTOCOL_VERSION,
        sequence: move.sequence,
        clientTick: tick,
        clientSampleTimeMs: nowMs,
        moveX: move.x,
        moveY: move.y,
        aimAngle: clientPose.angle,
        buttons: 0,
        selectedWeaponSlot: 0,
        controlledEntityId: VEHICLE_ID
      }, {
        previousSequence: move.sequence - 1,
        minimumClientTick: Math.max(0, tick - 24),
        maximumClientTick: tick,
        expectedControlledEntityId: VEHICLE_ID
      });
      assert.equal(
        validated.accepted,
        true,
        `generated command rejected at tick ${tick}, sequence ${move.sequence}: ${
          validated.accepted ? 'accepted' : validated.reason
        }`
      );
      if (validated.accepted) commandLink.send(nowMs, validated.value);
    }

    for (const command of commandLink.receive(nowMs)) {
      const admitted = validatePlayerInputCommand(command, {
        previousSequence: serverSequence,
        minimumClientTick: Math.max(0, tick - 24),
        maximumClientTick: tick,
        expectedControlledEntityId: VEHICLE_ID
      });
      assert.equal(admitted.accepted, true, `${profile.id} rejected a reliable command.`);
      if (!admitted.accepted) continue;
      serverSequence = admitted.value.sequence;
      held = {steering: admitted.value.moveX, throttle: -admitted.value.moveY};
    }
    authoritative = stepVehicleWithWorldCollision(
      authoritative.pose,
      held,
      'sedan',
      VEHICLE_SIMULATION_STEP_SECONDS,
      () => true
    );
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      const validated = validateInteractionSnapshot(snapshotFor(
        tick,
        nowMs,
        serverSequence,
        authoritative.pose,
        held
      ), {
        currentServerTick: tick,
        expectedWorldCollisionRevision: WORLD_COLLISION_REVISION
      });
      assert.equal(validated.accepted, true);
      if (validated.accepted) snapshotLink.send(nowMs, {snapshot: validated.value});
    }
    for (const packet of snapshotLink.receive(nowMs)) {
      const baseline = validateInteractionSnapshot(packet.snapshot, {
        currentServerTick: tick,
        expectedWorldCollisionRevision: WORLD_COLLISION_REVISION
      });
      assert.equal(baseline.accepted, true, `${profile.id} rejected a retained baseline.`);
      if (!baseline.accepted) continue;
      const vehicle = baseline.value.entities[0];
      assert.equal(vehicle.kind, 'vehicle');
      if (vehicle.kind !== 'vehicle') continue;
      const correction = prediction.reconcile({
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.speed
      }, baseline.value.acknowledgedLocalInputSequence, vehicle.vehicleKind, () => true);
      clientPose = correction.pose;
      recordCorrection(correction, errors);
      corrections += 1;
      if (correction.resimulated) resimulations += 1;
      if (correction.hardCorrection) hardCorrections += 1;
      maximumPendingMoves = Math.max(maximumPendingMoves, correction.pendingMoveCount);
    }
  }
  errors.sort((left, right) => left - right);
  return {
    profile,
    corrections,
    resimulations,
    hardCorrections,
    errorP95: percentile(errors, 0.95),
    maximumError: errors.at(-1) ?? 0,
    maximumPendingMoves,
    commandRetransmissions: commandLink.diagnostics().simulatedRetransmissions,
    snapshotRetransmissions: snapshotLink.diagnostics().simulatedRetransmissions
  };
}

function snapshotFor(
  serverTick: number,
  serverTimeMs: number,
  acknowledgedSequence: number,
  pose: {x: number; y: number; angle: number; speed: number},
  input: VehicleControlCommand
): Record<string, unknown> {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    serverTimeMs,
    worldCollisionRevision: WORLD_COLLISION_REVISION,
    controlRevision: 1,
    controlMode: 'driver',
    acknowledgedLocalInputSequence: acknowledgedSequence,
    entities: [{
      id: VEHICLE_ID,
      kind: 'vehicle',
      vehicleKind: 'sedan',
      spaceId: 'street',
      layerId: 'ground',
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
      velocityX: Math.cos(pose.angle) * pose.speed,
      velocityY: Math.sin(pose.angle) * pose.speed,
      angularVelocity: 0,
      colliderRevision: 1,
      lifecycleRevision: 1,
      interactionPriority: 'player-controlled',
      speed: pose.speed,
      steering: input.steering,
      engineDamage: 0,
      onFire: false,
      destroyed: false
    }],
    remoteIntents: [{
      entityId: VEHICLE_ID,
      appliedAtServerTick: serverTick,
      moveX: 0,
      moveY: 0,
      steering: input.steering,
      throttle: input.throttle
    }],
    confirmedEventsThrough: serverTick
  };
}

function scriptedMovement(tick: number): MovementVector {
  if (tick < 60) return {x: 0, y: -1};
  if (tick < 120) return {x: 0.65, y: -1};
  if (tick < 165) return {x: -0.75, y: -0.6};
  if (tick < 210) return {x: 0, y: 1};
  if (tick < 270) return {x: -0.45, y: -1};
  if (tick < 315) return {x: 0.8, y: -0.45};
  return {x: 0, y: 0};
}

function recordCorrection(correction: VehiclePredictionCorrection, errors: number[]): void {
  errors.push(correction.positionError);
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

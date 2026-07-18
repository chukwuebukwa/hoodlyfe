import {isVehicleKind} from '../../../shared/content/vehicle-catalog.ts';
import {
  POLICE_STINGER_SEGMENT_COUNT,
  policeStingerBurstMask,
  type StingerVehiclePose
} from '../../../shared/simulation/police-stinger-contact.ts';
import {normalizeVehicleTyreMask} from '../../../shared/simulation/vehicle-tyre-state.ts';
import {StingerState, type DistrictState, type NpcState} from '../../state.ts';
import type {GameEventStream} from '../events/game-events.ts';
import type {RoadClosureRegistry} from '../traffic/road-closure-registry.ts';
import type {PoliceRoadblockDeployment} from './police-roadblock-controller.ts';

export type PoliceStingerPhase = 'preparing' | 'deploying' | 'deployed' | 'retiring';

interface PoliceStingerRuntime {
  id: string;
  roadblockId: string;
  officerId: string;
  deployment: PoliceRoadblockDeployment;
  phase: PoliceStingerPhase;
  phaseStartedAt: number;
  contacts: number;
  lastVehicleId: string;
  lastBurstMask: number;
}

interface OwnedPedestrianPort {
  spawnOwnedAt(
    id: string,
    kind: 'civilian' | 'police',
    x: number,
    y: number,
    angle: number,
    action?: string
  ): NpcState;
  releaseOwned(npcId: string, nowMs: number): boolean;
}

interface PoliceStingerControllerOptions {
  state: DistrictState;
  roadblocks: () => readonly PoliceRoadblockDeployment[];
  pedestrians: OwnedPedestrianPort;
  closures: RoadClosureRegistry;
  events: GameEventStream;
  clock: () => {tick: number};
}

export interface PoliceStingerDiagnostic {
  stingerId: string;
  roadblockId: string;
  slotId: string;
  suspectId: string;
  officerId: string;
  phase: PoliceStingerPhase;
  x: number;
  y: number;
  angle: number;
  activeSegmentCount: number;
  contacts: number;
  lastVehicleId: string;
  lastBurstMask: number;
}

const PREPARE_DURATION_MS = 390;
const DEPLOY_DURATION_MS = 2_500;
const RETIRE_DURATION_MS = 2_500;
const MAXIMUM_ACTIVE_STINGERS = 2;
const CONTACT_BROAD_PHASE_RADIUS = 150;

/** Owns strip/officer lifecycle and tyre contact, independently of roadblock vehicles. */
export class PoliceStingerController {
  private readonly runtimes = new Map<string, PoliceStingerRuntime>();
  private readonly assignedRoadblockIds = new Set<string>();
  private previousVehiclePoses = new Map<string, StingerVehiclePose>();

  constructor(private readonly options: PoliceStingerControllerOptions) {}

  update(nowMs: number): void {
    const deployments = new Map(
      this.options.roadblocks().map((deployment) => [deployment.roadblockId, deployment])
    );
    for (const roadblockId of this.assignedRoadblockIds) {
      if (!deployments.has(roadblockId)) this.assignedRoadblockIds.delete(roadblockId);
    }
    for (const runtime of [...this.runtimes.values()].sort(compareRuntime)) {
      const deployment = deployments.get(runtime.roadblockId);
      if (deployment) runtime.deployment = deployment;
      this.updateRuntime(runtime, deployment, nowMs);
    }
    for (const deployment of [...deployments.values()].sort(compareDeployment)) {
      if (this.runtimes.size >= MAXIMUM_ACTIVE_STINGERS) break;
      if (
        deployment.phase !== 'deployed' ||
        this.assignedRoadblockIds.has(deployment.roadblockId) ||
        this.runtimes.has(stingerIdFor(deployment.roadblockId))
      ) continue;
      this.create(deployment, nowMs);
    }
    this.resolveVehicleContacts(nowMs);
    this.captureVehiclePoses();
  }

  ownsOfficer(officerId: string): boolean {
    return [...this.runtimes.values()].some((runtime) => runtime.officerId === officerId);
  }

  diagnostics(): PoliceStingerDiagnostic[] {
    return [...this.runtimes.values()].sort(compareRuntime).map((runtime) => {
      const state = this.options.state.stingers.get(runtime.id);
      return {
        stingerId: runtime.id,
        roadblockId: runtime.roadblockId,
        slotId: runtime.deployment.slotId,
        suspectId: runtime.deployment.suspectId,
        officerId: runtime.officerId,
        phase: runtime.phase,
        x: state?.x ?? runtime.deployment.stinger.x,
        y: state?.y ?? runtime.deployment.stinger.y,
        angle: state?.angle ?? runtime.deployment.stinger.angle,
        activeSegmentCount: state?.activeSegmentCount ?? 0,
        contacts: runtime.contacts,
        lastVehicleId: runtime.lastVehicleId,
        lastBurstMask: runtime.lastBurstMask
      };
    });
  }

  private create(deployment: PoliceRoadblockDeployment, nowMs: number): void {
    const id = stingerIdFor(deployment.roadblockId);
    const officerId = `${id}:officer`;
    const runtime: PoliceStingerRuntime = {
      id,
      roadblockId: deployment.roadblockId,
      officerId,
      deployment,
      phase: 'preparing',
      phaseStartedAt: nowMs,
      contacts: 0,
      lastVehicleId: '',
      lastBurstMask: 0
    };
    const stinger = new StingerState();
    stinger.id = id;
    stinger.roadblockId = deployment.roadblockId;
    stinger.slotId = deployment.slotId;
    stinger.suspectId = deployment.suspectId;
    stinger.ownerId = officerId;
    stinger.x = deployment.stinger.x;
    stinger.y = deployment.stinger.y;
    stinger.angle = deployment.stinger.angle;
    stinger.phase = runtime.phase;
    stinger.phaseStartedAt = nowMs;
    stinger.createdAt = nowMs;
    const officerPose = deployment.stinger.officerPose;
    let officerSpawned = false;
    try {
      this.options.pedestrians.spawnOwnedAt(
        officerId,
        'police',
        officerPose.x,
        officerPose.y,
        officerPose.angle,
        'deploy-stinger'
      );
      officerSpawned = true;
      this.options.state.stingers.set(id, stinger);
      this.options.closures.acquire(id, deployment.blockedEdgeIds);
      this.runtimes.set(id, runtime);
      this.assignedRoadblockIds.add(deployment.roadblockId);
    } catch (error) {
      this.options.state.stingers.delete(id);
      this.options.closures.release(id);
      if (officerSpawned) this.options.pedestrians.releaseOwned(officerId, nowMs);
      throw error;
    }
  }

  private updateRuntime(
    runtime: PoliceStingerRuntime,
    deployment: PoliceRoadblockDeployment | undefined,
    nowMs: number
  ): void {
    const stinger = this.options.state.stingers.get(runtime.id);
    const officer = this.options.state.npcs.get(runtime.officerId);
    if (!stinger) {
      this.finalize(runtime, nowMs);
      return;
    }
    if (
      runtime.phase !== 'retiring' &&
      (!deployment || deployment.phase !== 'deployed' || !officer?.alive)
    ) {
      this.beginRetirement(runtime, stinger, nowMs);
    }
    if (runtime.phase === 'preparing') {
      if (nowMs - runtime.phaseStartedAt < PREPARE_DURATION_MS) return;
      this.changePhase(runtime, stinger, 'deploying', nowMs);
      return;
    }
    if (runtime.phase === 'deploying') {
      const progress = normalizedProgress(nowMs, runtime.phaseStartedAt, DEPLOY_DURATION_MS);
      stinger.activeSegmentCount = Math.max(
        1,
        Math.min(POLICE_STINGER_SEGMENT_COUNT, Math.ceil(progress * POLICE_STINGER_SEGMENT_COUNT))
      );
      if (progress < 1) return;
      this.changePhase(runtime, stinger, 'deployed', nowMs);
      const currentOfficer = this.options.state.npcs.get(runtime.officerId);
      if (currentOfficer?.alive) currentOfficer.action = 'guard-stinger';
      this.options.events.publish({
        type: 'police.stinger-deployed',
        tick: this.options.clock().tick,
        nowMs,
        stingerId: runtime.id,
        roadblockId: runtime.roadblockId,
        officerId: runtime.officerId,
        suspectId: runtime.deployment.suspectId
      });
      return;
    }
    if (runtime.phase !== 'retiring') return;
    const progress = normalizedProgress(nowMs, runtime.phaseStartedAt, RETIRE_DURATION_MS);
    stinger.activeSegmentCount = Math.max(
      0,
      POLICE_STINGER_SEGMENT_COUNT - Math.ceil(progress * POLICE_STINGER_SEGMENT_COUNT)
    );
    if (progress >= 1 || stinger.activeSegmentCount === 0) this.finalize(runtime, nowMs);
  }

  private beginRetirement(
    runtime: PoliceStingerRuntime,
    stinger: StingerState,
    nowMs: number
  ): void {
    if (stinger.activeSegmentCount === 0) {
      this.finalize(runtime, nowMs);
      return;
    }
    this.changePhase(runtime, stinger, 'retiring', nowMs);
    const officer = this.options.state.npcs.get(runtime.officerId);
    if (officer?.alive) officer.action = 'recover';
  }

  private changePhase(
    runtime: PoliceStingerRuntime,
    stinger: StingerState,
    phase: PoliceStingerPhase,
    nowMs: number
  ): void {
    runtime.phase = phase;
    runtime.phaseStartedAt = nowMs;
    stinger.phase = phase;
    stinger.phaseStartedAt = nowMs;
    if (phase === 'deployed') stinger.activeSegmentCount = POLICE_STINGER_SEGMENT_COUNT;
  }

  private finalize(runtime: PoliceStingerRuntime, nowMs: number): void {
    if (!this.runtimes.has(runtime.id)) return;
    this.options.state.stingers.delete(runtime.id);
    this.options.closures.release(runtime.id);
    this.options.pedestrians.releaseOwned(runtime.officerId, nowMs);
    this.runtimes.delete(runtime.id);
    this.options.events.publish({
      type: 'police.stinger-cleared',
      tick: this.options.clock().tick,
      nowMs,
      stingerId: runtime.id,
      roadblockId: runtime.roadblockId,
      officerId: runtime.officerId
    });
  }

  private resolveVehicleContacts(nowMs: number): void {
    for (const runtime of [...this.runtimes.values()].sort(compareRuntime)) {
      const stinger = this.options.state.stingers.get(runtime.id);
      if (!stinger || stinger.activeSegmentCount <= 0) continue;
      for (const vehicle of [...this.options.state.vehicles.values()].sort((left, right) => (
        left.id.localeCompare(right.id)
      ))) {
        if (vehicle.destroyed || !isVehicleKind(vehicle.kind)) continue;
        const previous = this.previousVehiclePoses.get(vehicle.id) ?? vehicle;
        const travel = Math.hypot(vehicle.x - previous.x, vehicle.y - previous.y);
        if (
          Math.hypot(vehicle.x - stinger.x, vehicle.y - stinger.y) >
          CONTACT_BROAD_PHASE_RADIUS + travel
        ) continue;
        const burstMask = policeStingerBurstMask(
          stinger,
          previous,
          vehicle,
          vehicle.kind,
          vehicle.tyreDamageMask
        );
        if (burstMask === 0) continue;
        vehicle.tyreDamageMask = normalizeVehicleTyreMask(vehicle.tyreDamageMask | burstMask);
        runtime.contacts++;
        runtime.lastVehicleId = vehicle.id;
        runtime.lastBurstMask = burstMask;
        this.options.events.publish({
          type: 'vehicle.tyres-burst',
          tick: this.options.clock().tick,
          nowMs,
          stingerId: runtime.id,
          vehicleId: vehicle.id,
          burstMask,
          tyreDamageMask: vehicle.tyreDamageMask
        });
      }
    }
  }

  private captureVehiclePoses(): void {
    this.previousVehiclePoses = new Map([...this.options.state.vehicles.values()].map((vehicle) => [
      vehicle.id,
      Object.freeze({x: vehicle.x, y: vehicle.y, angle: vehicle.angle})
    ]));
  }
}

function stingerIdFor(roadblockId: string): string {
  return `police-stinger:${roadblockId}`;
}

function normalizedProgress(nowMs: number, startedAt: number, durationMs: number): number {
  return Math.max(0, Math.min(1, (nowMs - startedAt) / durationMs));
}

function compareRuntime(left: PoliceStingerRuntime, right: PoliceStingerRuntime): number {
  return left.id.localeCompare(right.id);
}

function compareDeployment(
  left: PoliceRoadblockDeployment,
  right: PoliceRoadblockDeployment
): number {
  return left.roadblockId.localeCompare(right.roadblockId);
}

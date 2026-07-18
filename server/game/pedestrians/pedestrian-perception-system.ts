import type {DistrictState, NpcState} from '../../state.ts';
import type {PursuitRecord} from '../police/pursuit-memory.ts';
import type {PoliceTactic} from '../police/pursuit-coordinator.ts';
import {
  clearPedestrianStimulus,
  clearPedestrianThreat,
  type PedestrianRuntime
} from './pedestrian-runtime.ts';
import type {WorldStimulus} from '../world/world-stimulus-registry.ts';

const PERCEPTION_INTERVAL_MS = 240;

export interface PedestrianPoliceTarget {
  pursuit?: PursuitRecord;
  canSeeTarget: boolean;
  targetDistance: number;
  tactic: PoliceTactic;
}

export type PedestrianObservation =
  | {kind: 'ambient'}
  | {
    kind: 'threat';
    sourceId: string;
    x: number;
    y: number;
    angleAway: number;
    angleToward: number;
    distance: number;
  }
  | {
    kind: 'stimulus';
    stimulusId: string;
    stimulusKind: WorldStimulus['kind'];
    sourceId: string;
    x: number;
    y: number;
    severity: number;
    radius: number;
    expiresAt: number;
    distance: number;
    angleAway: number;
    angleToward: number;
  }
  | {
    kind: 'police';
    response: PedestrianPoliceTarget & {pursuit: PursuitRecord; targetOnFootInStreet: boolean};
  };

interface PedestrianPerceptionOptions {
  state: DistrictState;
  policeTarget: (officer: NpcState, nowMs: number) => PedestrianPoliceTarget | undefined;
  nearestStimulus?: (x: number, y: number, nowMs: number) => WorldStimulus | undefined;
}

export class PedestrianPerceptionSystem {
  constructor(private readonly options: PedestrianPerceptionOptions) {}

  observe(npc: NpcState, runtime: PedestrianRuntime, nowMs: number): PedestrianObservation {
    if (npc.kind === 'police') {
      const response = this.options.policeTarget(npc, nowMs);
      if (response?.pursuit) {
        const target = this.options.state.players.get(response.pursuit.suspectId);
        return {
          kind: 'police',
          response: {
            ...response,
            pursuit: response.pursuit,
            targetOnFootInStreet: Boolean(target?.alive && !target.vehicleId && target.spaceId === 'street')
          }
        };
      }
    }
    const threat = this.observeThreat(npc, runtime, nowMs);
    if (threat) return threat;

    if (nowMs >= runtime.nextPerceptionAt) {
      runtime.nextPerceptionAt = nowMs + PERCEPTION_INTERVAL_MS;
      const stimulus = this.options.nearestStimulus?.(npc.x, npc.y, nowMs);
      if (stimulus) this.rememberStimulus(runtime, stimulus);
      else if (runtime.stimulusUntil <= nowMs) clearPedestrianStimulus(runtime);
    }
    if (
      runtime.stimulusUntil <= nowMs ||
      !runtime.stimulusKind ||
      !Number.isFinite(runtime.stimulusX) ||
      !Number.isFinite(runtime.stimulusY)
    ) return {kind: 'ambient'};

    const angleToward = Math.atan2(runtime.stimulusY - npc.y, runtime.stimulusX - npc.x);
    return {
      kind: 'stimulus',
      stimulusId: runtime.stimulusId,
      stimulusKind: runtime.stimulusKind,
      sourceId: runtime.stimulusSourceId,
      x: runtime.stimulusX,
      y: runtime.stimulusY,
      severity: runtime.stimulusSeverity,
      radius: runtime.stimulusRadius,
      expiresAt: runtime.stimulusUntil,
      distance: Math.hypot(runtime.stimulusX - npc.x, runtime.stimulusY - npc.y),
      angleAway: Math.atan2(npc.y - runtime.stimulusY, npc.x - runtime.stimulusX),
      angleToward
    };
  }

  rememberThreat(
    runtime: PedestrianRuntime,
    threatId: string,
    untilMs: number
  ): void {
    runtime.panicUntil = Math.max(runtime.panicUntil, untilMs);
    runtime.threatId = threatId;
  }

  private observeThreat(
    npc: NpcState,
    runtime: PedestrianRuntime,
    nowMs: number
  ): Extract<PedestrianObservation, {kind: 'threat'}> | undefined {
    if (runtime.panicUntil <= nowMs) {
      if (runtime.threatId) clearPedestrianThreat(runtime);
      return undefined;
    }
    const threat = this.options.state.players.get(runtime.threatId);
    if (threat) {
      runtime.lastKnownThreatX = threat.x;
      runtime.lastKnownThreatY = threat.y;
    }
    if (!Number.isFinite(runtime.lastKnownThreatX) || !Number.isFinite(runtime.lastKnownThreatY)) {
      return undefined;
    }
    const angleToward = Math.atan2(
      runtime.lastKnownThreatY - npc.y,
      runtime.lastKnownThreatX - npc.x
    );
    return {
      kind: 'threat',
      sourceId: runtime.threatId,
      x: runtime.lastKnownThreatX,
      y: runtime.lastKnownThreatY,
      angleAway: Math.atan2(
        npc.y - runtime.lastKnownThreatY,
        npc.x - runtime.lastKnownThreatX
      ),
      angleToward,
      distance: Math.hypot(
        runtime.lastKnownThreatX - npc.x,
        runtime.lastKnownThreatY - npc.y
      )
    };
  }

  private rememberStimulus(runtime: PedestrianRuntime, stimulus: WorldStimulus): void {
    runtime.stimulusId = stimulus.id;
    runtime.stimulusKind = stimulus.kind;
    runtime.stimulusSourceId = stimulus.sourceId;
    runtime.stimulusX = stimulus.x;
    runtime.stimulusY = stimulus.y;
    runtime.stimulusSeverity = stimulus.intensity;
    runtime.stimulusRadius = stimulus.radius;
    runtime.stimulusUntil = stimulus.expiresAt;
  }
}

import type {DistrictState, NpcState} from '../../state.ts';
import type {PursuitRecord} from '../police/pursuit-memory.ts';
import {clearPedestrianThreat, type PedestrianRuntime} from './pedestrian-runtime.ts';

export interface PedestrianPoliceTarget {
  pursuit?: PursuitRecord;
  canSeeTarget: boolean;
  targetDistance: number;
}

export type PedestrianObservation =
  | {kind: 'ambient'}
  | {kind: 'threat'; angleAway: number}
  | {kind: 'police'; response: PedestrianPoliceTarget & {pursuit: PursuitRecord}};

interface PedestrianPerceptionOptions {
  state: DistrictState;
  policeTarget: (officer: NpcState, nowMs: number) => PedestrianPoliceTarget | undefined;
}

export class PedestrianPerceptionSystem {
  constructor(private readonly options: PedestrianPerceptionOptions) {}

  observe(npc: NpcState, runtime: PedestrianRuntime, nowMs: number): PedestrianObservation {
    if (npc.kind === 'police') {
      const response = this.options.policeTarget(npc, nowMs);
      if (response?.pursuit) return {kind: 'police', response: {...response, pursuit: response.pursuit}};
    }
    if (runtime.panicUntil <= nowMs) {
      if (runtime.threatId) clearPedestrianThreat(runtime);
      return {kind: 'ambient'};
    }
    const threat = this.options.state.players.get(runtime.threatId);
    if (threat) {
      runtime.lastKnownThreatX = threat.x;
      runtime.lastKnownThreatY = threat.y;
    }
    if (!Number.isFinite(runtime.lastKnownThreatX) || !Number.isFinite(runtime.lastKnownThreatY)) {
      return {kind: 'ambient'};
    }
    return {
      kind: 'threat',
      angleAway: Math.atan2(
        npc.y - runtime.lastKnownThreatY,
        npc.x - runtime.lastKnownThreatX
      )
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
}

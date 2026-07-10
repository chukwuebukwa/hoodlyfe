import type {NpcState} from '../../state.ts';
import type {PedestrianIntent} from './pedestrian-intent.ts';
import type {PedestrianObservation} from './pedestrian-perception-system.ts';
import {
  clearPedestrianReaction,
  type PedestrianReactionResponse,
  type PedestrianRuntime
} from './pedestrian-runtime.ts';

const MINIMUM_FLEE_MS = 1200;
const RECOVERY_MS = 650;

interface ReactionCue {
  id: string;
  kind: string;
  x: number;
  y: number;
  severity: number;
  radius: number;
  expiresAt: number;
}

export class PedestrianReactionSystem {
  decide(
    npc: NpcState,
    runtime: PedestrianRuntime,
    observation: PedestrianObservation,
    nowMs: number
  ): PedestrianIntent | undefined {
    if (npc.kind === 'police') return undefined;
    const cue = cueFrom(observation, runtime);
    if (cue) this.observeCue(runtime, cue, nowMs);
    const reaction = runtime.reaction;
    if (reaction.phase === 'none') return undefined;

    const angleToward = Math.atan2(reaction.y - npc.y, reaction.x - npc.x);
    const angleAway = Math.atan2(npc.y - reaction.y, npc.x - reaction.x);
    const distance = Math.hypot(reaction.x - npc.x, reaction.y - npc.y);
    if (reaction.phase === 'orient') {
      if (nowMs < reaction.phaseUntil) {
        return intent('startle', angleToward, 0);
      }
      reaction.phase = 'respond';
    }

    if (reaction.phase === 'respond') {
      const reachedSafety = reaction.response === 'flee' &&
        nowMs - reaction.startedAt >= MINIMUM_FLEE_MS &&
        distance >= reaction.safeDistance;
      if (nowMs >= reaction.responseUntil || reachedSafety) {
        reaction.phase = 'recover';
        reaction.phaseUntil = nowMs + RECOVERY_MS;
      } else if (reaction.response === 'flee') {
        runtime.wanderAngle = angleAway;
        return intent('flee', angleAway, reaction.cueKind === 'explosion' ? 190 : 168);
      } else {
        return intent('investigate', angleToward, distance > 72 ? 58 : 0);
      }
    }

    if (reaction.phase === 'recover') {
      if (nowMs < reaction.phaseUntil) return intent('recover', angleAway, 0);
      clearPedestrianReaction(runtime);
    }
    return undefined;
  }

  private observeCue(runtime: PedestrianRuntime, cue: ReactionCue, nowMs: number): void {
    const reaction = runtime.reaction;
    if (reaction.cueId === cue.id) {
      reaction.x = cue.x;
      reaction.y = cue.y;
      reaction.severity = Math.max(reaction.severity, cue.severity);
      reaction.responseUntil = Math.max(reaction.responseUntil, cue.expiresAt + 1800);
      return;
    }
    if (
      reaction.phase !== 'none' &&
      reaction.phase !== 'recover' &&
      cue.severity < reaction.severity + 0.08
    ) return;

    const response: PedestrianReactionResponse = cue.severity < runtime.bravery
      ? 'investigate'
      : 'flee';
    const orientMs = 240 + (1 - runtime.bravery) * 260;
    reaction.phase = 'orient';
    reaction.cueId = cue.id;
    reaction.cueKind = cue.kind;
    reaction.response = response;
    reaction.x = cue.x;
    reaction.y = cue.y;
    reaction.severity = cue.severity;
    reaction.radius = cue.radius;
    reaction.startedAt = nowMs;
    reaction.phaseUntil = nowMs + orientMs;
    reaction.responseUntil = Math.max(
      cue.expiresAt + 1800,
      nowMs + (response === 'flee' ? 2600 + cue.severity * 2600 : 2800)
    );
    reaction.safeDistance = clamp(cue.radius * 0.45, 120, 300);
  }
}

function cueFrom(
  observation: PedestrianObservation,
  runtime: PedestrianRuntime
): ReactionCue | undefined {
  if (observation.kind === 'threat') {
    return {
      id: `threat:${observation.sourceId}`,
      kind: 'threat',
      x: observation.x,
      y: observation.y,
      severity: 1,
      radius: 340,
      expiresAt: runtime.panicUntil
    };
  }
  if (observation.kind !== 'stimulus') return undefined;
  return {
    id: observation.stimulusId,
    kind: observation.stimulusKind,
    x: observation.x,
    y: observation.y,
    severity: observation.severity,
    radius: observation.radius,
    expiresAt: observation.expiresAt
  };
}

function intent(
  objective: PedestrianIntent['objective'],
  angle: number,
  speed: number
): PedestrianIntent {
  return {objective, angle, speed, fire: false, aimAngle: angle};
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

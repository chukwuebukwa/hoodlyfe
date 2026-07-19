import type {NpcState} from '../../state.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {PedestrianObservation} from './pedestrian-perception-system.ts';
import type {PedestrianRuntime} from './pedestrian-runtime.ts';
import type {PedestrianIntent} from './pedestrian-intent.ts';
import {PedestrianReactionSystem} from './pedestrian-reaction-system.ts';
import {decidePoliceForce} from '../police/police-force-policy.ts';
import {
  applyPoliceAimError,
  policeFireDiscipline
} from '../police/police-marksmanship-policy.ts';

interface PedestrianBehaviorOptions {
  random: DeterministicRandom;
  clock: () => {tick: number};
}

export class PedestrianBehaviorSystem {
  private readonly reactions = new PedestrianReactionSystem();

  constructor(private readonly options: PedestrianBehaviorOptions) {}

  decide(
    npc: NpcState,
    runtime: PedestrianRuntime,
    observation: PedestrianObservation,
    nowMs: number
  ): PedestrianIntent {
    let intent: PedestrianIntent;
    if (observation.kind === 'police') {
      intent = this.policeIntent(npc, runtime, observation, nowMs);
    } else if (npc.kind !== 'police') {
      intent = this.reactions.decide(npc, runtime, observation, nowMs) ??
        this.wanderIntent(npc, runtime, nowMs);
    } else if (observation.kind === 'threat') {
      intent = this.threatIntent(npc, runtime, observation);
    } else if (observation.kind === 'stimulus') {
      intent = this.stimulusIntent(npc, runtime, observation);
    } else {
      intent = this.wanderIntent(npc, runtime, nowMs);
    }
    runtime.objective = intent.objective;
    return intent;
  }

  private threatIntent(
    npc: NpcState,
    runtime: PedestrianRuntime,
    observation: Extract<PedestrianObservation, {kind: 'threat'}>
  ): PedestrianIntent {
    if (npc.kind === 'police') {
      return {
        objective: 'pursue',
        angle: observation.angleToward,
        speed: observation.distance > 90 ? 150 : 0,
        fire: false,
        aimAngle: observation.angleToward,
        targetX: observation.x,
        targetY: observation.y
      };
    }
    runtime.wanderAngle = observation.angleAway;
    return {
      objective: 'flee',
      angle: observation.angleAway,
      speed: 175,
      fire: false,
      aimAngle: observation.angleAway
    };
  }

  private stimulusIntent(
    npc: NpcState,
    runtime: PedestrianRuntime,
    observation: Extract<PedestrianObservation, {kind: 'stimulus'}>
  ): PedestrianIntent {
    const shouldInvestigate = npc.kind === 'police' || observation.severity < runtime.bravery;
    if (shouldInvestigate) {
      return {
        objective: 'investigate',
        angle: observation.angleToward,
        speed: observation.distance > (npc.kind === 'police' ? 55 : 72)
          ? (npc.kind === 'police' ? 128 : 58)
          : 0,
        fire: false,
        aimAngle: observation.angleToward,
        targetX: observation.x,
        targetY: observation.y
      };
    }
    runtime.wanderAngle = observation.angleAway;
    return {
      objective: 'flee',
      angle: observation.angleAway,
      speed: observation.stimulusKind === 'explosion' ? 190 : 168,
      fire: false,
      aimAngle: observation.angleAway
    };
  }

  private policeIntent(
    npc: NpcState,
    runtime: PedestrianRuntime,
    observation: Extract<PedestrianObservation, {kind: 'police'}>,
    nowMs: number
  ): PedestrianIntent {
    const {
      pursuit,
      canSeeTarget,
      targetDistance,
      targetOnFootInStreet,
      targetAction = '',
      wantedLevel = 1,
      tactic
    } = observation.response;
    const moveAngle = Math.atan2(tactic.goalY - npc.y, tactic.goalX - npc.x);
    const idealAimAngle = Math.atan2(pursuit.lastKnownY - npc.y, pursuit.lastKnownX - npc.x);
    const distance = Math.hypot(tactic.goalX - npc.x, tactic.goalY - npc.y);
    const objective = tactic.phase === 'contain'
      ? 'contain'
      : (tactic.phase === 'search' ? 'search' : 'pursue');
    const stopDistance = tactic.phase === 'contain' ? 22 : (pursuit.mode === 'pursuit' ? 165 : 28);
    const force = decidePoliceForce({
      role: tactic.role,
      officerInControl: npc.alive && npc.health > 0 && !npc.reactionKind,
      targetAlive: true,
      targetWantedLevel: wantedLevel,
      targetAction,
      targetOnFootInStreet,
      canSeeTarget,
      targetDistance
    });
    const canMelee = force.response === 'melee' && nowMs >= runtime.melee.cooldownUntil;
    const fireDiscipline = policeFireDiscipline(wantedLevel, targetDistance);
    const canFire = force.response === 'fire' &&
      fireDiscipline.authorized &&
      nowMs - runtime.lastShotAt >= fireDiscipline.cooldownMs;
    const aimAngle = canFire
      ? applyPoliceAimError(
        idealAimAngle,
        fireDiscipline.maximumAngularError,
        this.options.random.unit(
          'police-aim-error',
          `${npc.id}:${this.options.clock().tick}:${Math.floor(nowMs)}`
        )
      )
      : idealAimAngle;
    if (canFire) runtime.lastShotAt = nowMs;
    return {
      objective,
      angle: moveAngle,
      speed: force.stopForContact
        ? 0
        : (distance > stopDistance ? (pursuit.mode === 'pursuit' ? 158 : 132) : 0),
      fire: canFire,
      aimAngle,
      targetX: tactic.goalX,
      targetY: tactic.goalY,
      meleeTargetId: canMelee ? pursuit.suspectId : undefined,
      arrestTargetId: force.response === 'arrest' ? pursuit.suspectId : undefined
    };
  }

  private wanderIntent(
    npc: NpcState,
    runtime: PedestrianRuntime,
    nowMs: number
  ): PedestrianIntent {
    if (nowMs >= runtime.nextThinkAt) {
      const key = `${npc.id}:${this.options.clock().tick}`;
      runtime.wanderAngle += (
        this.options.random.unit('npc-wander-turn', key) - 0.5
      ) * Math.PI * 1.6;
      runtime.nextThinkAt = nowMs + this.options.random.range(
        'npc-think-delay',
        key,
        1200,
        3800
      );
    }
    return {
      objective: 'wander',
      angle: runtime.wanderAngle,
      speed: npc.kind === 'police' ? 78 : 62,
      fire: false,
      aimAngle: runtime.wanderAngle
    };
  }
}

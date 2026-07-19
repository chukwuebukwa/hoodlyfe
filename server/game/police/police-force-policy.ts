import type {PoliceTacticalRole} from './pursuit-coordinator.ts';

export const POLICE_ARREST = Object.freeze({
  contactDistance: 44,
  breakDistance: 76,
  durationMs: 2600
});

export type PoliceForceResponse = 'arrest' | 'melee' | 'fire' | 'hold';
export type PoliceForceReason =
  | 'custody-contact'
  | 'resisting-contact'
  | 'visible-threat'
  | 'no-authorized-force';

export interface PoliceForceContext {
  role: PoliceTacticalRole;
  officerInControl: boolean;
  targetAlive: boolean;
  targetWantedLevel: number;
  targetAction: string;
  targetOnFootInStreet: boolean;
  canSeeTarget: boolean;
  targetDistance: number;
}

export interface PoliceForceDecision {
  response: PoliceForceResponse;
  reason: PoliceForceReason;
  stopForContact: boolean;
}

const ARRESTABLE_ACTIONS = new Set(['', 'entering', 'hijacking', 'hit', 'knockdown']);

/**
 * Pure force-selection policy. Allocation, movement, animation, damage and custody
 * remain owned by their respective systems.
 */
export function decidePoliceForce(context: PoliceForceContext): PoliceForceDecision {
  if (context.targetAction === 'arrested') {
    return {response: 'hold', reason: 'no-authorized-force', stopForContact: true};
  }
  const validTarget = context.officerInControl &&
    context.targetAlive &&
    context.targetWantedLevel > 0;
  const contact = validTarget &&
    context.role === 'primary' &&
    context.canSeeTarget &&
    context.targetOnFootInStreet &&
    context.targetDistance <= POLICE_ARREST.contactDistance;
  if (contact && ARRESTABLE_ACTIONS.has(context.targetAction)) {
    return {response: 'arrest', reason: 'custody-contact', stopForContact: true};
  }
  if (contact) {
    return {response: 'melee', reason: 'resisting-contact', stopForContact: true};
  }
  if (
    validTarget &&
    context.targetWantedLevel >= 2 &&
    context.canSeeTarget &&
    context.targetDistance < 430
  ) {
    return {response: 'fire', reason: 'visible-threat', stopForContact: false};
  }
  return {response: 'hold', reason: 'no-authorized-force', stopForContact: false};
}

export function custodyFineForWanted(wantedLevel: number): number {
  const level = Math.max(1, Math.min(5, Math.floor(wantedLevel)));
  return Math.min(5000, 200 * level * level);
}

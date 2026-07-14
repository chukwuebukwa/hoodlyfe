import {
  type CombatFireCommand,
  type CombatFireReceipt,
  validateCombatFireCommand
} from '../../../shared/protocol/combat-fire.ts';
import type {DistrictState} from '../../state.ts';
import type {FireControlResult} from './fire-control-controller.ts';

interface CombatFireCommandControllerOptions {
  readonly state: DistrictState;
  readonly clock: () => {readonly tick: number; readonly nowMs: number};
  readonly fire: (playerId: string, command: CombatFireCommand) => FireControlResult;
  readonly send: (playerId: string, receipt: CombatFireReceipt) => void;
}

interface AcceptedCommandState {
  sequence: number;
  clientSampleTimeMs: number;
}

export class CombatFireCommandController {
  private readonly accepted = new Map<string, AcceptedCommandState>();

  constructor(private readonly options: CombatFireCommandControllerOptions) {}

  accept(playerId: string, message: unknown): CombatFireReceipt {
    const clock = this.options.clock();
    const player = this.options.state.players.get(playerId);
    const previous = this.accepted.get(playerId);
    const validated = validateCombatFireCommand(message, {
      previousSequence: previous?.sequence ?? 0,
      expectedControlledEntityId: playerId,
      minimumClientSampleTimeMs: previous?.clientSampleTimeMs
    });
    if (!player || player.spaceId !== 'street') {
      const receipt = rejectedReceipt(
        sequenceFrom(message),
        clock,
        'invalid-controlled-entity'
      );
      this.options.send(playerId, receipt);
      return receipt;
    }
    if (!validated.accepted) {
      const receipt = rejectedReceipt(sequenceFrom(message), clock, validated.reason);
      this.options.send(playerId, receipt);
      return receipt;
    }
    this.accepted.set(playerId, {
      sequence: validated.value.sequence,
      clientSampleTimeMs: validated.value.clientSampleTimeMs
    });
    const result = this.options.fire(playerId, validated.value);
    const receipt: CombatFireReceipt = Object.freeze({
      sequence: validated.value.sequence,
      status: result.accepted ? 'accepted' : 'rejected',
      reason: result.reason,
      serverTick: clock.tick,
      serverTimeMs: clock.nowMs,
      effectiveServerShotTimeMs: result.effectiveServerShotTimeMs,
      rewindMs: result.rewindMs,
      projectiles: Object.freeze(result.projectiles.map((projectile) => Object.freeze({
        clientSpawnId: projectile.clientSpawnId,
        authoritativeSpawnId: projectile.authoritativeSpawnId,
        status: projectile.resolved ? 'resolved' as const : 'active' as const
      })))
    });
    this.options.send(playerId, receipt);
    return receipt;
  }

  clearPlayer(playerId: string): void {
    this.accepted.delete(playerId);
  }
}

function rejectedReceipt(
  sequence: number,
  clock: {readonly tick: number; readonly nowMs: number},
  reason: string
): CombatFireReceipt {
  return Object.freeze({
    sequence,
    status: 'rejected',
    reason,
    serverTick: clock.tick,
    serverTimeMs: clock.nowMs,
    effectiveServerShotTimeMs: clock.nowMs,
    rewindMs: 0,
    projectiles: Object.freeze([])
  });
}

function sequenceFrom(message: unknown): number {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return 0;
  const sequence = (message as Record<string, unknown>).sequence;
  return Number.isSafeInteger(sequence) && Number(sequence) >= 0 ? Number(sequence) : 0;
}

import {
  type CombatFireCommand,
  validateCombatFireCommand
} from '../../../shared/protocol/combat-fire.ts';
import type {DistrictState} from '../../state.ts';
import type {FireControlResult} from './fire-control-controller.ts';

interface CombatFireCommandControllerOptions {
  readonly state: DistrictState;
  readonly fire: (playerId: string, command: CombatFireCommand) => FireControlResult;
}

interface AcceptedCommandState {
  sequence: number;
  clientSampleTimeMs: number;
}

export class CombatFireCommandController {
  private readonly accepted = new Map<string, AcceptedCommandState>();

  constructor(private readonly options: CombatFireCommandControllerOptions) {}

  accept(playerId: string, message: unknown): FireControlResult {
    const player = this.options.state.players.get(playerId);
    const previous = this.accepted.get(playerId);
    const validated = validateCombatFireCommand(message, {
      previousSequence: previous?.sequence ?? 0,
      expectedControlledEntityId: playerId,
      minimumClientSampleTimeMs: previous?.clientSampleTimeMs
    });
    if (!player || player.spaceId !== 'street') {
      return {accepted: false, reason: 'invalid-controlled-entity'};
    }
    if (!validated.accepted) {
      return validated;
    }
    this.accepted.set(playerId, {
      sequence: validated.value.sequence,
      clientSampleTimeMs: validated.value.clientSampleTimeMs
    });
    return this.options.fire(playerId, validated.value);
  }

  clearPlayer(playerId: string): void {
    this.accepted.delete(playerId);
  }
}

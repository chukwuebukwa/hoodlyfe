import {
  validateWeaponReloadRequest,
  type WeaponReloadRequest
} from '../../../shared/protocol/weapon-reload.ts';
import type {WeaponRuntimeController, WeaponRuntimeResult} from './weapon-runtime-controller.ts';

export interface WeaponReloadCommandResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly sequence: number;
  readonly weapon?: WeaponRuntimeResult['weapon'];
  readonly magazine?: number;
  readonly reserve?: number;
  readonly reloadSequence?: number;
  readonly reloadEndsAt?: number;
}

export class WeaponReloadCommandController {
  private readonly lastSequence = new Map<string, number>();

  constructor(private readonly runtime: WeaponRuntimeController) {}

  accept(playerId: string, message: unknown): WeaponReloadCommandResult {
    const validated = validateWeaponReloadRequest(message, playerId);
    const rawSequence = requestSequence(message);
    if (!validated.accepted) {
      return {accepted: false, reason: validated.reason, sequence: rawSequence};
    }
    const previous = this.lastSequence.get(playerId) ?? 0;
    if (validated.value.sequence <= previous) {
      return {accepted: false, reason: 'stale-sequence', sequence: validated.value.sequence};
    }
    if (validated.value.sequence - previous > 4_096) {
      return {accepted: false, reason: 'sequence-window-exceeded', sequence: validated.value.sequence};
    }
    this.lastSequence.set(playerId, validated.value.sequence);
    return {...this.runtime.requestReload(playerId), sequence: validated.value.sequence};
  }

  clearPlayer(playerId: string): void {
    this.lastSequence.delete(playerId);
  }
}

function requestSequence(message: unknown): number {
  const sequence = (message as Partial<WeaponReloadRequest> | null)?.sequence;
  return Number.isSafeInteger(sequence) && Number(sequence) >= 0 ? Number(sequence) : 0;
}

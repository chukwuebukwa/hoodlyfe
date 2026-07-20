import type {Room} from 'colyseus.js';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {
  COMBAT_FIRE_RECEIPT_MESSAGE,
  COMBAT_FIRE_MESSAGE,
  COMBAT_PROTOCOL_VERSION,
  type CombatFireCommand,
  type CombatFireReceipt
} from '../../../shared/protocol/combat-fire.ts';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';

interface CombatFireCommandSenderOptions {
  readonly room: Room<DistrictNetworkState>;
  readonly player: () => NetworkPlayer | undefined;
  readonly estimatedServerTimeMs: () => number;
  readonly combatRewindEnabled: () => boolean;
  readonly onReceipt?: (receipt: CombatFireReceipt) => void;
}

export class CombatFireCommandSender {
  private nextSequence = 1;
  private lastSampleTimeMs = 0;
  private readonly removeReceipt?: () => void;

  constructor(private readonly options: CombatFireCommandSenderOptions) {
    const room = options.room as Room<DistrictNetworkState> & {
      onMessage?: <Message>(type: string, callback: (message: Message) => void) => unknown;
    };
    const remove = room.onMessage?.<CombatFireReceipt>(COMBAT_FIRE_RECEIPT_MESSAGE, (receipt) => {
      if (receipt.protocolVersion === COMBAT_PROTOCOL_VERSION) options.onReceipt?.(receipt);
    });
    this.removeReceipt = typeof remove === 'function' ? remove as () => void : undefined;
  }

  send(angle: number): void {
    const player = this.options.player();
    if (!player?.alive || !Number.isFinite(angle)) return;
    if ((player.spaceId || STREET_SPACE_ID) !== STREET_SPACE_ID || !this.options.combatRewindEnabled()) {
      this.options.room.send('shoot');
      return;
    }
    const sampleTimeMs = this.options.estimatedServerTimeMs();
    if (Number.isFinite(sampleTimeMs) && sampleTimeMs >= 0) {
      this.lastSampleTimeMs = Math.max(this.lastSampleTimeMs, sampleTimeMs);
    }
    const command: CombatFireCommand = {
      protocolVersion: COMBAT_PROTOCOL_VERSION,
      sequence: this.nextSequence++,
      clientSampleTimeMs: this.lastSampleTimeMs,
      controlledEntityId: player.id,
      aimAngle: angle
    };
    this.options.room.send(COMBAT_FIRE_MESSAGE, command);
  }

  destroy(): void {
    this.removeReceipt?.();
  }
}

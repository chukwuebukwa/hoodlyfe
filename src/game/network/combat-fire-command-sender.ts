import type {Room} from 'colyseus.js';
import {weaponDefinition} from '../../../shared/content/weapon-catalog.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {
  COMBAT_FIRE_MESSAGE,
  COMBAT_PROTOCOL_VERSION,
  type CombatFireCommand
} from '../../../shared/protocol/combat-fire.ts';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';

interface CombatFireCommandSenderOptions {
  readonly room: Room<DistrictNetworkState>;
  readonly player: () => NetworkPlayer | undefined;
  readonly estimatedServerTimeMs: () => number;
  readonly combatRewindEnabled: () => boolean;
}

export class CombatFireCommandSender {
  private nextSequence = 1;
  private nextSpawnId = 1;
  private lastSampleTimeMs = 0;

  constructor(private readonly options: CombatFireCommandSenderOptions) {}

  send(angle: number): void {
    const player = this.options.player();
    if (!player?.alive || !Number.isFinite(angle)) return;
    if ((player.spaceId || STREET_SPACE_ID) !== STREET_SPACE_ID || !this.options.combatRewindEnabled()) {
      this.options.room.send('shoot');
      return;
    }
    const weapon = weaponDefinition(player.weapon);
    const spawnCount = weapon.fireMode === 'bullet' ? weapon.pellets : 0;
    const predictedSpawnIds = Array.from({length: spawnCount}, () => this.nextSpawnId++);
    const sampleTimeMs = this.options.estimatedServerTimeMs();
    if (Number.isFinite(sampleTimeMs) && sampleTimeMs >= 0) {
      this.lastSampleTimeMs = Math.max(this.lastSampleTimeMs, sampleTimeMs);
    }
    const command: CombatFireCommand = {
      protocolVersion: COMBAT_PROTOCOL_VERSION,
      sequence: this.nextSequence++,
      clientSampleTimeMs: this.lastSampleTimeMs,
      controlledEntityId: player.id,
      aimAngle: angle,
      predictedSpawnIds
    };
    this.options.room.send(COMBAT_FIRE_MESSAGE, command);
  }
}

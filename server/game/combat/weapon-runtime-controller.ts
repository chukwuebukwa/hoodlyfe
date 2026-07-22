import type {DistrictState, PlayerState} from '../../state.ts';
import {
  WEAPONS,
  isMagazineWeaponId,
  type MagazineWeaponId
} from '../../../shared/content/weapon-catalog.ts';
import {
  ammoFor,
  clearReload,
  magazineFor,
  setAmmo,
  setMagazine
} from '../../weapons.ts';

export type WeaponRuntimeRejection =
  | 'not-allowed'
  | 'not-reloadable'
  | 'full-magazine'
  | 'no-reserve'
  | 'empty-magazine';

export interface WeaponRuntimeResult {
  readonly accepted: boolean;
  readonly reason?: WeaponRuntimeRejection;
  readonly weapon?: MagazineWeaponId;
  readonly magazine?: number;
  readonly reserve?: number;
  readonly reloadSequence?: number;
  readonly reloadEndsAt?: number;
}

interface WeaponRuntimeControllerOptions {
  readonly state: DistrictState;
  readonly clock: () => {nowMs: number};
}

export class WeaponRuntimeController {
  constructor(private readonly options: WeaponRuntimeControllerOptions) {}

  requestReload(playerId: string): WeaponRuntimeResult {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || player.action || (player.vehicleId && player.vehicleSeat === 0)) {
      return {accepted: false, reason: 'not-allowed'};
    }
    if (!isMagazineWeaponId(player.weapon)) {
      return {accepted: false, reason: 'not-reloadable'};
    }
    const weapon = player.weapon;
    const definition = WEAPONS[weapon];
    const magazine = magazineFor(player, weapon);
    const reserve = ammoFor(player, weapon);
    if (magazine >= definition.magazineSize) return this.result(player, weapon, false, 'full-magazine');
    if (reserve <= 0) return this.result(player, weapon, false, 'no-reserve');
    if (player.reloadWeapon === weapon) return this.result(player, weapon, true);

    clearReload(player);
    player.reloadWeapon = weapon;
    player.reloadStartedAt = this.options.clock().nowMs;
    player.reloadEndsAt = player.reloadStartedAt + definition.reloadMs;
    player.reloadSequence += 1;
    return this.result(player, weapon, true);
  }

  canFire(player: PlayerState, weapon: MagazineWeaponId): WeaponRuntimeResult {
    const magazine = magazineFor(player, weapon);
    if (player.reloadWeapon) {
      if (magazine > 0) this.cancelReload(player);
      else return this.result(player, weapon, false, 'empty-magazine');
    }
    if (magazine > 0) return this.result(player, weapon, true);
    this.requestReload(player.id);
    return this.result(player, weapon, false, 'empty-magazine');
  }

  consumeShot(player: PlayerState, weapon: MagazineWeaponId): WeaponRuntimeResult {
    const available = this.canFire(player, weapon);
    if (!available.accepted) return available;
    setMagazine(player, weapon, magazineFor(player, weapon) - 1);
    player.shotSequence += 1;
    if (magazineFor(player, weapon) === 0 && ammoFor(player, weapon) > 0) {
      this.requestReload(player.id);
    }
    return this.result(player, weapon, true);
  }

  update(nowMs: number): void {
    this.options.state.players.forEach((player) => {
      if (!player.reloadWeapon) return;
      if (!this.canContinue(player)) {
        this.cancelReload(player);
        return;
      }
      if (nowMs < player.reloadEndsAt) return;
      const weapon = player.reloadWeapon;
      const definition = WEAPONS[weapon];
      const missing = Math.max(0, definition.magazineSize - magazineFor(player, weapon));
      const transfer = Math.min(
        definition.reloadStyle === 'per-shell' ? 1 : missing,
        missing,
        ammoFor(player, weapon)
      );
      if (transfer > 0) {
        setMagazine(player, weapon, magazineFor(player, weapon) + transfer);
        setAmmo(player, weapon, ammoFor(player, weapon) - transfer);
      }
      const shouldContinue = definition.reloadStyle === 'per-shell' &&
        magazineFor(player, weapon) < definition.magazineSize && ammoFor(player, weapon) > 0;
      if (shouldContinue) {
        player.reloadStartedAt = nowMs;
        player.reloadEndsAt = nowMs + definition.reloadMs;
      } else {
        clearReload(player);
      }
    });
  }

  cancelReload(playerOrId: PlayerState | string): void {
    const player = typeof playerOrId === 'string'
      ? this.options.state.players.get(playerOrId)
      : playerOrId;
    if (player) clearReload(player);
  }

  private canContinue(player: PlayerState): player is PlayerState & {reloadWeapon: MagazineWeaponId} {
    return Boolean(
      player.alive &&
      !player.action &&
      isMagazineWeaponId(player.reloadWeapon) &&
      player.weapon === player.reloadWeapon &&
      (!player.vehicleId || player.vehicleSeat > 0) &&
      magazineFor(player, player.reloadWeapon as MagazineWeaponId) <
        WEAPONS[player.reloadWeapon as MagazineWeaponId].magazineSize &&
      ammoFor(player, player.reloadWeapon as MagazineWeaponId) > 0
    );
  }

  private result(
    player: PlayerState,
    weapon: MagazineWeaponId,
    accepted: boolean,
    reason?: WeaponRuntimeRejection
  ): WeaponRuntimeResult {
    return Object.freeze({
      accepted,
      ...(reason ? {reason} : {}),
      weapon,
      magazine: magazineFor(player, weapon),
      reserve: ammoFor(player, weapon),
      reloadSequence: player.reloadSequence,
      reloadEndsAt: player.reloadEndsAt
    });
  }
}

import {
  cloneAppearance,
  DEFAULT_APPEARANCE,
  validateAppearance,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';
import type {DistrictState, PlayerAppearanceState, PlayerState} from '../../state.ts';
import type {AppearanceUpdateStatus} from '../../../shared/protocol/appearance.ts';
import type {WardrobeInventoryController} from '../appearance/wardrobe-inventory-controller.ts';

const UPDATE_COOLDOWN_MS = 150;

interface PlayerAppearanceControllerOptions {
  state: DistrictState;
  clock: () => {nowMs: number};
  wardrobe: Pick<WardrobeInventoryController, 'canEquip'>;
}

export type AppearanceUpdateResult = AppearanceUpdateStatus;

export class PlayerAppearanceController {
  private readonly nextUpdateAt = new Map<string, number>();

  constructor(private readonly options: PlayerAppearanceControllerOptions) {}

  initialize(player: PlayerState, rawAppearance: unknown): PlayerAppearance {
    const requested = validateAppearance(rawAppearance);
    const appearance = requested && this.options.wardrobe.canEquip(player.id, requested)
      ? requested
      : cloneAppearance(DEFAULT_APPEARANCE);
    assignAppearance(player.appearance, appearance);
    return appearance;
  }

  update(playerId: string, rawAppearance: unknown): AppearanceUpdateResult {
    const player = this.options.state.players.get(playerId);
    if (!player) return 'missing';
    const appearance = validateAppearance(rawAppearance);
    if (!appearance) return 'invalid';
    if (!this.options.wardrobe.canEquip(playerId, appearance)) return 'unowned';
    const nowMs = this.options.clock().nowMs;
    if (nowMs < (this.nextUpdateAt.get(playerId) ?? Number.NEGATIVE_INFINITY)) {
      return 'rate-limited';
    }
    assignAppearance(player.appearance, appearance);
    this.nextUpdateAt.set(playerId, nowMs + UPDATE_COOLDOWN_MS);
    return 'applied';
  }

  clearPlayer(playerId: string): void {
    this.nextUpdateAt.delete(playerId);
  }
}

function assignAppearance(target: PlayerAppearanceState, appearance: PlayerAppearance): void {
  target.outfitName = appearance.outfitName;
  target.bodyType = appearance.bodyType;
  target.skinTone = appearance.skinTone;
  target.hairStyle = appearance.hairStyle;
  target.hairColor = appearance.hairColor;
  target.headwear = appearance.headwear;
  target.topStyle = appearance.topStyle;
  target.topColor = appearance.topColor;
  target.accentColor = appearance.accentColor;
  target.bottomStyle = appearance.bottomStyle;
  target.bottomColor = appearance.bottomColor;
  target.shoeStyle = appearance.shoeStyle;
  target.shoeColor = appearance.shoeColor;
}

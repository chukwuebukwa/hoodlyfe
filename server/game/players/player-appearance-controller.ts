import {
  cloneAppearance,
  DEFAULT_APPEARANCE,
  validateAppearance,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';
import type {DistrictState, PlayerAppearanceState, PlayerState} from '../../state.ts';

const UPDATE_COOLDOWN_MS = 150;

interface PlayerAppearanceControllerOptions {
  state: DistrictState;
  clock: () => {nowMs: number};
}

export type AppearanceUpdateResult = 'applied' | 'invalid' | 'missing' | 'rate-limited';

export class PlayerAppearanceController {
  private readonly nextUpdateAt = new Map<string, number>();

  constructor(private readonly options: PlayerAppearanceControllerOptions) {}

  initialize(player: PlayerState, rawAppearance: unknown): PlayerAppearance {
    const appearance = validateAppearance(rawAppearance) ?? cloneAppearance(DEFAULT_APPEARANCE);
    assignAppearance(player.appearance, appearance);
    return appearance;
  }

  update(playerId: string, rawAppearance: unknown): AppearanceUpdateResult {
    const player = this.options.state.players.get(playerId);
    if (!player) return 'missing';
    const appearance = validateAppearance(rawAppearance);
    if (!appearance) return 'invalid';
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

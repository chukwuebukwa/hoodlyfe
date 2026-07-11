import type {PlayerAppearance} from '../content/appearance-catalog.ts';

export const PLAYER_SPAWN_MESSAGE = 'player.spawn';

export interface PlayerSpawnMessage {
  name?: string;
  appearance?: PlayerAppearance;
}

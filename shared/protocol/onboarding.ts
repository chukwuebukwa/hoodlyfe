import type {PlayerAppearance} from '../content/appearance-catalog.ts';
import type {ClientAuthPayload} from './auth.ts';

export const PLAYER_SPAWN_MESSAGE = 'player.spawn';

export interface PlayerSpawnMessage {
  name?: string;
  appearance?: PlayerAppearance;
  auth?: ClientAuthPayload;
}

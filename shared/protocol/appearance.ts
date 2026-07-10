import type {PlayerAppearance} from '../content/appearance-catalog.ts';

export const APPEARANCE_UPDATE_MESSAGE = 'appearance.update';
export const APPEARANCE_RESULT_MESSAGE = 'appearance.result';

export type AppearanceUpdateMessage = PlayerAppearance;

export type AppearanceUpdateStatus =
  | 'applied'
  | 'invalid'
  | 'missing'
  | 'rate-limited'
  | 'unowned';

export interface AppearanceResultMessage {
  status: AppearanceUpdateStatus;
}

import {
  cloneAppearance,
  DEFAULT_APPEARANCE,
  validateAppearance,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';

const STORAGE_KEY = 'nock0-player-appearance';

export function loadSavedAppearance(storage: Storage = window.localStorage): PlayerAppearance {
  try {
    return validateAppearance(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')) ??
      cloneAppearance(DEFAULT_APPEARANCE);
  } catch {
    return cloneAppearance(DEFAULT_APPEARANCE);
  }
}

export function saveAppearance(
  appearance: PlayerAppearance,
  storage: Storage = window.localStorage
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage can be disabled; authoritative room state still receives the update.
  }
}

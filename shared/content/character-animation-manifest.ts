export const CHARACTER_FRAME_SIZE = 72;
export const CHARACTER_ASSET_VERSION = 3;

export type CharacterAtlasId = 'walk' | 'actions';
export type CharacterClipId =
  | 'idle'
  | 'walk'
  | 'melee'
  | 'hit'
  | 'knockdown'
  | 'dead'
  | 'vehicleEnter'
  | 'carjack'
  | 'ejected';

export interface CharacterFrameAnchor {
  readonly rootX: number;
  readonly rootY: number;
  readonly handX: number;
  readonly handY: number;
  readonly headX: number;
  readonly headY: number;
}

export interface CharacterClipDefinition {
  readonly id: CharacterClipId;
  readonly atlas: CharacterAtlasId;
  readonly frames: readonly number[];
  readonly frameMs: number;
  readonly loop: boolean;
}

export interface CharacterAtlasDefinition {
  readonly id: CharacterAtlasId;
  readonly columns: number;
  readonly rows: number;
  readonly frameSize: number;
  readonly source: string;
  readonly materialMask: string;
}

export const CHARACTER_ATLASES: Readonly<Record<CharacterAtlasId, CharacterAtlasDefinition>> =
  Object.freeze({
    walk: {
      id: 'walk', columns: 3, rows: 3, frameSize: CHARACTER_FRAME_SIZE,
      source: '/assets/custom/characters/standard-01/base/walk.png?v=3',
      materialMask: '/assets/custom/characters/standard-01/masks/walk-materials.png?v=3'
    },
    actions: {
      id: 'actions', columns: 4, rows: 3, frameSize: CHARACTER_FRAME_SIZE,
      source: '/assets/custom/actions/player-actions.png?v=3',
      materialMask: '/assets/custom/characters/standard-01/masks/actions-materials.png?v=3'
    }
  });

export const CHARACTER_CLIPS: Readonly<Record<CharacterClipId, CharacterClipDefinition>> =
  Object.freeze({
    idle: clip('idle', 'walk', [0], 240, true),
    walk: clip('walk', 'walk', [1, 2, 3, 4, 5, 6, 7, 8], 105, true),
    melee: clip('melee', 'actions', [0, 1, 2, 3], 110, true),
    hit: clip('hit', 'actions', [4, 5], 140, true),
    knockdown: clip('knockdown', 'actions', [4, 5, 6, 7], 145, false),
    dead: clip('dead', 'actions', [7], 500, false),
    vehicleEnter: clip('vehicleEnter', 'actions', [8, 9, 10, 11], 100, false),
    carjack: clip('carjack', 'actions', [8, 9, 10, 11], 180, true),
    ejected: clip('ejected', 'actions', [4, 5, 6, 7, 7, 6, 5, 4], 138, false)
  });

export const DEFAULT_CHARACTER_ANCHOR: CharacterFrameAnchor = Object.freeze({
  rootX: 36, rootY: 48, handX: 44, handY: 31, headX: 36, headY: 20
});

export function characterClipFrame(clipId: CharacterClipId, elapsedMs: number): number {
  const definition = CHARACTER_CLIPS[clipId];
  const rawIndex = Math.max(0, Math.floor(elapsedMs / Math.max(1, definition.frameMs)));
  const index = definition.loop
    ? rawIndex % definition.frames.length
    : Math.min(definition.frames.length - 1, rawIndex);
  return definition.frames[index];
}

export function characterClipProgressFrame(clipId: CharacterClipId, progress: number): number {
  const definition = CHARACTER_CLIPS[clipId];
  const clamped = Math.max(0, Math.min(0.999, Number.isFinite(progress) ? progress : 0));
  return definition.frames[Math.floor(clamped * definition.frames.length)];
}

function clip(
  id: CharacterClipId,
  atlas: CharacterAtlasId,
  frames: readonly number[],
  frameMs: number,
  loop: boolean
): CharacterClipDefinition {
  return Object.freeze({id, atlas, frames: Object.freeze(frames), frameMs, loop});
}

export interface DeathmatchSpawnPose {
  x: number;
  y: number;
  angle: number;
}

export interface ArenaDeathmatchDefinition {
  id: string;
  label: string;
  assetRoot: string;
  scoreLimit: number;
  durationMs: number;
  spawns: readonly DeathmatchSpawnPose[];
}

const BLOCK_SIZE = 40;
const tileCenter = (column: number, row: number): {x: number; y: number} => ({
  x: column * BLOCK_SIZE + BLOCK_SIZE / 2,
  y: row * BLOCK_SIZE + BLOCK_SIZE / 2
});

export const FOUNDRY_YARD_DEATHMATCH: ArenaDeathmatchDefinition = Object.freeze({
  id: 'foundry-yard',
  label: 'Foundry Yard',
  assetRoot: '/assets/districts/deathmatch',
  scoreLimit: 15,
  durationMs: 8 * 60_000,
  spawns: Object.freeze([
    {...tileCenter(7, 7), angle: Math.PI / 4},
    {...tileCenter(40, 7), angle: 3 * Math.PI / 4},
    {...tileCenter(40, 40), angle: -3 * Math.PI / 4},
    {...tileCenter(7, 40), angle: -Math.PI / 4},
    {...tileCenter(23, 6), angle: Math.PI / 2},
    {...tileCenter(41, 23), angle: Math.PI},
    {...tileCenter(23, 41), angle: -Math.PI / 2},
    {...tileCenter(6, 23), angle: 0}
  ])
});

export interface RaceCheckpointDefinition {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface RaceGridPose {
  x: number;
  y: number;
  angle: number;
}

export interface ArenaRaceTrackDefinition {
  id: string;
  label: string;
  assetRoot: string;
  laps: number;
  checkpoints: readonly RaceCheckpointDefinition[];
  grid: readonly RaceGridPose[];
}

const RACEWAY_BLOCK_SIZE = 40;
const tileCenter = (column: number, row: number): {x: number; y: number} => ({
  x: column * RACEWAY_BLOCK_SIZE + RACEWAY_BLOCK_SIZE / 2,
  y: row * RACEWAY_BLOCK_SIZE + RACEWAY_BLOCK_SIZE / 2
});

const START = tileCenter(40, 64);

export const INDUSTRIAL_ARENA_CIRCUIT: ArenaRaceTrackDefinition = Object.freeze({
  id: 'industrial-arena-circuit',
  label: 'Nock0 Raceway',
  assetRoot: '/assets/districts/raceway',
  laps: 3,
  checkpoints: Object.freeze([
    {id: 'start-finish', ...START, radius: 130},
    {id: 'west-sweeper', ...tileCenter(13, 59), radius: 145},
    {id: 'west-rise', ...tileCenter(9, 37), radius: 145},
    {id: 'northwest-complex', ...tileCenter(14, 17), radius: 145},
    {id: 'north-straight', ...tileCenter(38, 7), radius: 145},
    {id: 'northeast-sweeper', ...tileCenter(63, 19), radius: 145},
    {id: 'east-curve', ...tileCenter(60, 42), radius: 145},
    {id: 'southeast-sweeper', ...tileCenter(65, 52), radius: 145},
    {id: 'final-curve', ...tileCenter(58, 61), radius: 145}
  ]),
  grid: Object.freeze([
    {x: tileCenter(43, 62).x, y: tileCenter(43, 62).y, angle: Math.PI},
    {x: tileCenter(43, 66).x, y: tileCenter(43, 66).y, angle: Math.PI},
    {x: tileCenter(47, 62).x, y: tileCenter(47, 62).y, angle: Math.PI},
    {x: tileCenter(47, 66).x, y: tileCenter(47, 66).y, angle: Math.PI},
    {x: tileCenter(51, 62).x, y: tileCenter(51, 62).y, angle: Math.PI},
    {x: tileCenter(51, 66).x, y: tileCenter(51, 66).y, angle: Math.PI}
  ])
});

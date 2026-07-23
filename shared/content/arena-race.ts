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

const tileCenter = (column: number, row: number): {x: number; y: number} => ({
  x: column * 64 + 32,
  y: row * 64 + 32
});

const START = tileCenter(20, 35);

export const INDUSTRIAL_ARENA_CIRCUIT: ArenaRaceTrackDefinition = Object.freeze({
  id: 'industrial-arena-circuit',
  label: 'Nock0 Raceway',
  assetRoot: '/assets/districts/raceway',
  laps: 3,
  checkpoints: Object.freeze([
    {id: 'start-finish', ...START, radius: 120},
    {id: 'west-sweeper', ...tileCenter(5, 29), radius: 130},
    {id: 'infield-switchback-one', ...tileCenter(10, 18), radius: 130},
    {id: 'infield-switchback-two', ...tileCenter(5, 13), radius: 130},
    {id: 'northwest-hairpin', ...tileCenter(7, 6), radius: 130},
    {id: 'north-straight', ...tileCenter(25, 5), radius: 130},
    {id: 'northeast-hairpin', ...tileCenter(34, 9), radius: 130},
    {id: 'east-switchback-one', ...tileCenter(30, 20), radius: 130},
    {id: 'east-switchback-two', ...tileCenter(35, 25), radius: 130},
    {id: 'final-sweeper', ...tileCenter(33, 32), radius: 130}
  ]),
  grid: Object.freeze([
    {x: tileCenter(22, 34).x, y: tileCenter(22, 34).y, angle: Math.PI},
    {x: tileCenter(24, 36).x, y: tileCenter(24, 36).y, angle: Math.PI},
    {x: tileCenter(26, 34).x, y: tileCenter(26, 34).y, angle: Math.PI},
    {x: tileCenter(28, 36).x, y: tileCenter(28, 36).y, angle: Math.PI},
    {x: tileCenter(30, 34).x, y: tileCenter(30, 34).y, angle: Math.PI},
    {x: tileCenter(31, 36).x, y: tileCenter(31, 36).y, angle: Math.PI}
  ])
});

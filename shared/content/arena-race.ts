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

const START_X = 1_312;
const START_Y = 3_488;

export const INDUSTRIAL_ARENA_CIRCUIT: ArenaRaceTrackDefinition = Object.freeze({
  id: 'industrial-arena-circuit',
  label: 'Industrial Arena Circuit',
  assetRoot: '/assets/districts/raceway',
  laps: 3,
  checkpoints: Object.freeze([
    {id: 'start-finish', x: START_X, y: START_Y, radius: 92},
    {id: 'northwest-turn', x: START_X, y: 1_440, radius: 112},
    {id: 'west-switchback', x: 160, y: 1_440, radius: 112},
    {id: 'north-hairpin', x: 160, y: 544, radius: 112},
    {id: 'east-hairpin', x: 2_336, y: 544, radius: 112},
    {id: 'south-straight', x: 2_336, y: START_Y, radius: 112}
  ]),
  grid: Object.freeze([
    {x: START_X - 34, y: START_Y + 70, angle: -Math.PI / 2},
    {x: START_X + 34, y: START_Y + 142, angle: -Math.PI / 2},
    {x: START_X - 34, y: START_Y + 214, angle: -Math.PI / 2},
    {x: START_X + 34, y: START_Y + 286, angle: -Math.PI / 2},
    {x: START_X - 34, y: START_Y + 358, angle: -Math.PI / 2},
    {x: START_X + 34, y: START_Y + 430, angle: -Math.PI / 2}
  ])
});

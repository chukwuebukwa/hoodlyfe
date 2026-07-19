import {districtPoint} from './district-map-frame.ts';

export interface StreetLightFixture {
  id: string;
  x: number;
  y: number;
  source: 'traffic-gantry' | 'provisional';
}

export const STREET_LIGHT_FIXTURES: readonly StreetLightFixture[] = Object.freeze([
  fixture('foundry-nw', 2328, 832, 'traffic-gantry'),
  fixture('foundry-ne', 2472, 832, 'traffic-gantry'),
  fixture('foundry-sw', 2328, 1088, 'traffic-gantry'),
  fixture('foundry-se', 2472, 1088, 'traffic-gantry'),
  fixture('foundry-west-n', 2176, 920, 'traffic-gantry'),
  fixture('foundry-west-s', 2176, 1000, 'traffic-gantry'),
  fixture('foundry-east-n', 2560, 920, 'traffic-gantry'),
  fixture('foundry-east-s', 2560, 1000, 'traffic-gantry'),
  fixture('threads-nw', 2328, 1920, 'traffic-gantry'),
  fixture('threads-ne', 2472, 1920, 'traffic-gantry'),
  fixture('threads-sw', 2328, 2304, 'traffic-gantry'),
  fixture('threads-se', 2472, 2304, 'traffic-gantry'),
  fixture('threads-east-n', 2624, 2048, 'traffic-gantry'),
  fixture('threads-east-s', 2624, 2176, 'traffic-gantry'),
  fixture('hospital-corner', 2848, 1904, 'provisional'),
  fixture('foundry-service-road', 1904, 960, 'provisional')
]);

function fixture(
  id: string,
  x: number,
  y: number,
  source: StreetLightFixture['source']
): Readonly<StreetLightFixture> {
  return Object.freeze({id, ...districtPoint(x, y), source});
}

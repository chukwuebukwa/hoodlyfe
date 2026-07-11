import type {StreetLightFixture} from '../../../shared/content/lighting-fixtures.ts';

export interface RoadMask {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: Array<{name: string; data: number[]}>;
}

export interface RoadLightOptions {
  coverageRadius?: number;
  existing?: readonly StreetLightFixture[];
}

export interface RoadLightCoverage {
  covered: number;
  total: number;
  ratio: number;
  maximumDistance: number;
}

interface RoadPoint {
  column: number;
  row: number;
  x: number;
  y: number;
}

export function deriveRoadLightEmitters(
  map: RoadMask,
  optionsOrLegacySpacing: RoadLightOptions | number = {}
): StreetLightFixture[] {
  const roads = roadLayer(map);
  if (!roads) return [];
  const options = typeof optionsOrLegacySpacing === 'number'
    ? {coverageRadius: Math.max(2, optionsOrLegacySpacing) * Math.max(map.tilewidth, map.tileheight)}
    : optionsOrLegacySpacing;
  const coverageRadius = Math.max(64, options.coverageRadius ?? 168);
  const coverageSources = [...(options.existing ?? [])];
  const emitters: StreetLightFixture[] = [];

  for (const point of roadPoints(map, roads)) {
    if (nearestDistance(point, coverageSources) <= coverageRadius) continue;
    const fixture = fixtureForRoadPoint(map, roads, point);
    emitters.push(fixture);
    coverageSources.push(fixture);
  }
  return emitters;
}

export function measureRoadLightCoverage(
  map: RoadMask,
  fixtures: readonly StreetLightFixture[],
  coverageRadius = 168
): RoadLightCoverage {
  const roads = roadLayer(map);
  if (!roads) return {covered: 0, total: 0, ratio: 1, maximumDistance: 0};
  const points = roadPoints(map, roads);
  let covered = 0;
  let maximumDistance = 0;
  for (const point of points) {
    const distance = nearestDistance(point, fixtures);
    if (distance <= coverageRadius) covered++;
    maximumDistance = Math.max(maximumDistance, distance);
  }
  return {
    covered,
    total: points.length,
    ratio: points.length === 0 ? 1 : covered / points.length,
    maximumDistance
  };
}

export function mergeLightEmitters(
  authored: readonly StreetLightFixture[],
  generated: readonly StreetLightFixture[],
  minimumSeparation = 72
): StreetLightFixture[] {
  const merged = [...authored];
  for (const candidate of generated) {
    if (nearestDistance(candidate, merged) < minimumSeparation) continue;
    merged.push(candidate);
  }
  return merged;
}

function roadLayer(map: RoadMask): number[] | undefined {
  const roads = map.layers.find((layer) => layer.name === 'roads')?.data;
  return roads?.length === map.width * map.height ? roads : undefined;
}

function roadPoints(map: RoadMask, roads: readonly number[]): RoadPoint[] {
  const points: RoadPoint[] = [];
  for (let row = 0; row < map.height; row++) {
    for (let column = 0; column < map.width; column++) {
      if (!roads[row * map.width + column]) continue;
      points.push({
        column,
        row,
        x: (column + 0.5) * map.tilewidth,
        y: (row + 0.5) * map.tileheight
      });
    }
  }
  return points;
}

function fixtureForRoadPoint(
  map: RoadMask,
  roads: readonly number[],
  point: RoadPoint
): StreetLightFixture {
  const edges = [
    {column: point.column - 1, row: point.row, dx: -0.42, dy: 0},
    {column: point.column + 1, row: point.row, dx: 0.42, dy: 0},
    {column: point.column, row: point.row - 1, dx: 0, dy: -0.42},
    {column: point.column, row: point.row + 1, dx: 0, dy: 0.42}
  ];
  const edge = edges.find(({column, row}) => (
    column < 0 || row < 0 || column >= map.width || row >= map.height ||
    !roads[row * map.width + column]
  ));
  return {
    id: `road-emitter-${point.column}-${point.row}`,
    x: (point.column + 0.5 + (edge?.dx ?? 0)) * map.tilewidth,
    y: (point.row + 0.5 + (edge?.dy ?? 0)) * map.tileheight,
    source: 'provisional'
  };
}

function nearestDistance(
  point: Pick<StreetLightFixture, 'x' | 'y'>,
  fixtures: readonly Pick<StreetLightFixture, 'x' | 'y'>[]
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const fixture of fixtures) {
    nearest = Math.min(nearest, Math.hypot(fixture.x - point.x, fixture.y - point.y));
  }
  return nearest;
}

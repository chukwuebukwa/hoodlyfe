export const STREET_SPACE_ID = 'street';

export interface InteriorObstacle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface InteriorDefinition {
  id: string;
  label: string;
  floorZ: number;
  exteriorDoor: {
    x: number;
    y: number;
    radius: number;
    exitX: number;
    exitY: number;
  };
  bounds: InteriorObstacle;
  entry: {x: number; y: number; angle: number};
  exitDoor: InteriorObstacle;
  obstacles: readonly InteriorObstacle[];
}

export const INTERIORS: readonly InteriorDefinition[] = Object.freeze([
  Object.freeze({
    id: 'threads-showroom',
    label: 'Threads Showroom',
    floorZ: 196,
    exteriorDoor: {
      x: 2190,
      y: 2112,
      radius: 20,
      exitX: 2218,
      exitY: 2112
    },
    bounds: {minX: 1872, minY: 1992, maxX: 2168, maxY: 2168},
    entry: {x: 2120, y: 2112, angle: Math.PI},
    exitDoor: {minX: 2136, minY: 2082, maxX: 2172, maxY: 2142},
    obstacles: Object.freeze([
      {minX: 1910, minY: 2020, maxX: 1990, maxY: 2060},
      {minX: 1910, minY: 2100, maxX: 1990, maxY: 2140},
      {minX: 2040, minY: 2025, maxX: 2100, maxY: 2135}
    ])
  })
]);

export function interiorDefinition(spaceId: string): InteriorDefinition | undefined {
  return INTERIORS.find((interior) => interior.id === spaceId);
}

export function containsPoint(area: InteriorObstacle, x: number, y: number): boolean {
  return x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY;
}

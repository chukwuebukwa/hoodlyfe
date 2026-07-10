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
  kind: 'hospital' | 'clothing';
  floorZ: number;
  exteriorDoor: {
    x: number;
    y: number;
    radius: number;
    exitX: number;
    exitY: number;
    side: 'east' | 'south';
  };
  bounds: InteriorObstacle;
  entry: {x: number; y: number; angle: number};
  recoveryAnchor?: {x: number; y: number; angle: number};
  exitDoor: InteriorObstacle;
  obstacles: readonly InteriorObstacle[];
  serviceAnchors: readonly InteriorServiceAnchor[];
}

export interface InteriorServiceAnchor {
  id: string;
  x: number;
  y: number;
}

export const INTERIORS: readonly InteriorDefinition[] = Object.freeze([
  Object.freeze({
    id: 'mercy-hospital',
    label: 'Mercy Hospital',
    kind: 'hospital' as const,
    floorZ: 132,
    exteriorDoor: {
      x: 2632,
      y: 1944,
      radius: 20,
      exitX: 2632,
      exitY: 1972,
      side: 'south' as const
    },
    bounds: {minX: 2560, minY: 1664, maxX: 2816, maxY: 1920},
    entry: {x: 2632, y: 1880, angle: -Math.PI / 2},
    recoveryAnchor: {x: 2676, y: 1756, angle: Math.PI / 2},
    exitDoor: {minX: 2602, minY: 1884, maxX: 2662, maxY: 1916},
    obstacles: Object.freeze([
      {minX: 2588, minY: 1692, maxX: 2652, maxY: 1732},
      {minX: 2700, minY: 1692, maxX: 2764, maxY: 1732},
      {minX: 2588, minY: 1780, maxX: 2648, maxY: 1812},
      {minX: 2690, minY: 1800, maxX: 2760, maxY: 1844}
    ]),
    serviceAnchors: Object.freeze([
      {id: 'hospital-mercy', x: 2672, y: 1840}
    ])
  })
]);

export function interiorDefinition(spaceId: string): InteriorDefinition | undefined {
  return INTERIORS.find((interior) => interior.id === spaceId);
}

export function interiorServiceAnchor(
  serviceId: string
): {spaceId: string; x: number; y: number} | undefined {
  for (const interior of INTERIORS) {
    const anchor = interior.serviceAnchors.find((candidate) => candidate.id === serviceId);
    if (anchor) return {spaceId: interior.id, x: anchor.x, y: anchor.y};
  }
  return undefined;
}

export function containsPoint(area: InteriorObstacle, x: number, y: number): boolean {
  return x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY;
}

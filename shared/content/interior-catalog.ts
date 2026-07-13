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
  kind: InteriorKind;
  roofTriangleCount: number;
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

export type InteriorKind = 'hospital' | 'clothing' | 'ammunition' | 'vehicle-store';

export interface InteriorDraftPayload {
  version: number;
  generatedBy: string;
  interiors: InteriorDefinition[];
}

export const INTERIOR_GAME_DRAFT_STORAGE_KEY = 'nock0-interiors-game-draft-v1';

export const INTERIORS: readonly InteriorDefinition[] = Object.freeze([
  Object.freeze({
    id: 'mercy-hospital',
    label: 'Mercy Hospital',
    kind: 'hospital' as const,
    roofTriangleCount: 32,
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
  }),
  Object.freeze({
    id: 'ammunation-store',
    label: 'Ammu-Nation',
    kind: 'ammunition' as const,
    roofTriangleCount: 24,
    floorZ: 132,
    exteriorDoor: {
      x: 624,
      y: 856,
      radius: 20,
      exitX: 624,
      exitY: 884,
      side: 'south' as const
    },
    bounds: {minX: 448, minY: 640, maxX: 704, maxY: 832},
    entry: {x: 624, y: 792, angle: -Math.PI / 2},
    exitDoor: {minX: 594, minY: 796, maxX: 654, maxY: 828},
    obstacles: Object.freeze([
      {minX: 476, minY: 668, maxX: 516, maxY: 748},
      {minX: 536, minY: 668, maxX: 576, maxY: 748},
      {minX: 638, minY: 686, maxX: 682, maxY: 760}
    ]),
    serviceAnchors: Object.freeze([
      {id: 'ammunition-counter', x: 608, y: 720}
    ])
  }),
  Object.freeze({
    id: 'threads-store',
    label: 'Threads',
    kind: 'clothing' as const,
    roofTriangleCount: 42,
    floorZ: 132,
    exteriorDoor: {
      x: 1952,
      y: 856,
      radius: 20,
      exitX: 1952,
      exitY: 884,
      side: 'south' as const
    },
    bounds: {minX: 1728, minY: 640, maxX: 2176, maxY: 832},
    entry: {x: 1952, y: 792, angle: -Math.PI / 2},
    exitDoor: {minX: 1922, minY: 796, maxX: 1982, maxY: 828},
    obstacles: Object.freeze([
      {minX: 1760, minY: 668, maxX: 1840, maxY: 708},
      {minX: 1872, minY: 668, maxX: 1952, maxY: 708},
      {minX: 1760, minY: 732, maxX: 1840, maxY: 772},
      {minX: 2050, minY: 688, maxX: 2120, maxY: 780}
    ]),
    serviceAnchors: Object.freeze([
      {id: 'clothing-store', x: 1992, y: 744}
    ])
  }),
  Object.freeze({
    id: 'southside-clinic',
    label: 'Southside Clinic',
    kind: 'hospital' as const,
    roofTriangleCount: 48,
    floorZ: 132,
    exteriorDoor: {
      x: 3392,
      y: 1368,
      radius: 20,
      exitX: 3392,
      exitY: 1396,
      side: 'south' as const
    },
    bounds: {minX: 3200, minY: 1088, maxX: 3584, maxY: 1344},
    entry: {x: 3392, y: 1304, angle: -Math.PI / 2},
    recoveryAnchor: {x: 3300, y: 1160, angle: Math.PI / 2},
    exitDoor: {minX: 3362, minY: 1308, maxX: 3422, maxY: 1340},
    obstacles: Object.freeze([
      {minX: 3232, minY: 1120, maxX: 3296, maxY: 1160},
      {minX: 3330, minY: 1120, maxX: 3394, maxY: 1160},
      {minX: 3232, minY: 1210, maxX: 3312, maxY: 1242},
      {minX: 3470, minY: 1160, maxX: 3540, maxY: 1210}
    ]),
    serviceAnchors: Object.freeze([
      {id: 'hospital-southside', x: 3490, y: 1250}
    ])
  })
]);

export function interiorDefinition(spaceId: string): InteriorDefinition | undefined {
  return INTERIORS.find((interior) => interior.id === spaceId);
}

export function clientInteriorDefinitions(): readonly InteriorDefinition[] {
  if (typeof window === 'undefined') return INTERIORS;
  const stored = window.localStorage.getItem(INTERIOR_GAME_DRAFT_STORAGE_KEY);
  if (!stored) return INTERIORS;
  try {
    const payload = JSON.parse(stored) as InteriorDraftPayload;
    if (!Array.isArray(payload.interiors) || payload.interiors.length === 0) return INTERIORS;
    return payload.interiors;
  } catch {
    return INTERIORS;
  }
}

export function clientInteriorDefinition(spaceId: string): InteriorDefinition | undefined {
  return clientInteriorDefinitions().find((interior) => interior.id === spaceId);
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

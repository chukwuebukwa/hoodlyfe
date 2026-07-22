import type {
  LaneCorridor,
  LaneGraphDocument,
  LaneJunction,
  LaneRoadClass,
  LaneRoadblock,
  LevelEditorDocument,
  Point2D
} from './level-document.ts';
import {compileLaneNetwork} from '../../../shared/traffic/lane-network-compiler.ts';

export interface RoadNetworkGenerationStats {
  sourceRoadCells: number;
  retainedRoadCells: number;
  discardedRoadComponents: number;
  skeletonCells: number;
  corridors: number;
  junctions: number;
  terminalNodes: number;
  multiLaneCorridors: number;
  clearanceConstrainedCorridors: number;
  roadClasses: Record<LaneRoadClass, number>;
}

export interface GeneratedRoadNetwork {
  lanes: LaneGraphDocument;
  stats: RoadNetworkGenerationStats;
}

export interface RoadNetworkGenerationOptions {
  roadblocks?: readonly LaneRoadblock[];
}

interface TilePoint {
  x: number;
  y: number;
}

interface NodeRegion {
  pixels: number[];
  point: TilePoint;
}

interface TracedCorridor {
  from: number;
  to: number;
  pixels: number[];
}

const CARDINAL_NEIGHBORS: readonly TilePoint[] = [
  {x: 0, y: -1},
  {x: 1, y: 0},
  {x: 0, y: 1},
  {x: -1, y: 0}
];

const EIGHT_NEIGHBORS: readonly TilePoint[] = [
  {x: 0, y: -1},
  {x: 1, y: -1},
  {x: 1, y: 0},
  {x: 1, y: 1},
  {x: 0, y: 1},
  {x: -1, y: 1},
  {x: -1, y: 0},
  {x: -1, y: -1}
];

const NODE_REGION_RADIUS = 0;
const MINIMUM_CORRIDOR_CELLS = 2;
const SIMPLIFICATION_TOLERANCE_TILES = 0;

/**
 * Converts the editor's complete road-cell surface into an editable centerline graph.
 * The largest connected road component is retained so decorative and inaccessible road
 * islands cannot create disconnected traffic graphs.
 */
export function generateRoadNetwork(
  document: LevelEditorDocument,
  options: RoadNetworkGenerationOptions = {}
): GeneratedRoadNetwork {
  const width = document.map.width;
  const height = document.map.height;
  const sourceMask = Uint8Array.from(document.layers.roads, (value) => Number(value !== 0));
  const components = connectedComponents(sourceMask, width, height);
  const retained = components[0] ?? [];
  const roadMask = new Uint8Array(sourceMask.length);
  for (const index of retained) roadMask[index] = 1;

  const skeleton = thinRoadSurface(roadMask, width, height);
  const graphNeighbors = createSkeletonNeighborLookup(skeleton, width, height);
  const {regions, regionByPixel} = findNodeRegions(skeleton, width, height, graphNeighbors);
  const traced = traceCorridors(skeleton, width, height, regions, regionByPixel, graphNeighbors)
    .filter((corridor) => corridor.pixels.length >= MINIMUM_CORRIDOR_CELLS);
  const incident = Array.from({length: regions.length}, () => [] as number[]);
  traced.forEach((corridor, index) => {
    incident[corridor.from].push(index);
    if (corridor.to !== corridor.from) incident[corridor.to].push(index);
  });

  const centerlineCorridors: LaneCorridor[] = traced.map((corridor, index) => {
    const from = regions[corridor.from].point;
    const to = regions[corridor.to].point;
    const tilePoints = simplifyPolyline([
      from,
      ...corridor.pixels.slice(1, -1).map((pixel) => pointFromIndex(pixel, width)),
      to
    ], SIMPLIFICATION_TOLERANCE_TILES);
    const radii = tilePoints.map((point) => roadRadiusAt(roadMask, width, height, point));
    const roadRadius = median(radii);
    const measuredHalfWidth = (roadRadius + 0.5) * document.map.tileSize;
    const terminal = incident[corridor.from].length === 1 || incident[corridor.to].length === 1;
    const lengthTiles = polylineLength(tilePoints);
    const roadClass = classifyRoad(roadRadius, lengthTiles, terminal);
    return {
      id: numberedId('road', index),
      speedLimit: roadClassSpeed(roadClass),
      lanesPerDirection: preferredLaneCount(roadClass, measuredHalfWidth),
      roadClass,
      laneOffset: laneOffsetForWidth(measuredHalfWidth),
      laneSpacing: 34,
      measuredHalfWidth,
      routePriority: roadClassPriority(roadClass),
      trafficDensity: roadClassDensity(roadClass),
      points: tilePoints.map((point) => tileCenterToWorld(document, point))
    };
  });

  const centerlineJunctions: LaneJunction[] = [];
  let terminalNodes = 0;
  regions.forEach((region, regionIndex) => {
    const corridorIndexes = incident[regionIndex];
    if (corridorIndexes.length === 0) return;
    const terminalTransfer = corridorIndexes.length === 1;
    if (terminalTransfer) terminalNodes++;
    centerlineJunctions.push({
      id: numberedId('road-junction', centerlineJunctions.length),
      ...tileCenterToWorld(document, region.point),
      corridors: corridorIndexes.map((index) => centerlineCorridors[index].id).sort(),
      ...(terminalTransfer ? {terminalTransfer: true} : {})
    });
  });
  fitCorridorLaneOffsets(document, roadMask, centerlineCorridors, centerlineJunctions);
  const {corridors, junctions} = splitIntoDirectionalCarriageways(
    centerlineCorridors,
    centerlineJunctions
  );
  const roadClasses: Record<LaneRoadClass, number> = {
    arterial: 0,
    boulevard: 0,
    street: 0,
    service: 0,
    alley: 0
  };
  for (const corridor of corridors) roadClasses[corridor.roadClass ?? 'street']++;

  return {
    lanes: {
      ...document.lanes,
      schemaVersion: 2,
      laneOffset: 16.5,
      laneSpacing: 34,
      corridors,
      junctions,
      roadblocks: rebindRoadblocks(options.roadblocks ?? document.lanes.roadblocks ?? [], corridors)
    },
    stats: {
      sourceRoadCells: sourceMask.reduce((sum, value) => sum + value, 0),
      retainedRoadCells: retained.length,
      discardedRoadComponents: Math.max(0, components.length - 1),
      skeletonCells: skeleton.reduce((sum, value) => sum + value, 0),
      corridors: corridors.length,
      junctions: junctions.length,
      terminalNodes,
      multiLaneCorridors: corridors.filter((corridor) => (corridor.lanesPerDirection ?? 1) > 1).length,
      clearanceConstrainedCorridors: corridors.filter((corridor) => corridor.clearanceConstrained).length,
      roadClasses
    }
  };
}

function splitIntoDirectionalCarriageways(
  centerlines: readonly LaneCorridor[],
  junctions: readonly LaneJunction[]
): {corridors: LaneCorridor[]; junctions: LaneJunction[]} {
  const directionalIds = new Map<string, [string, string]>();
  const corridors = centerlines.flatMap((centerline): LaneCorridor[] => {
    const forwardId = `${centerline.id}-forward`;
    const reverseId = `${centerline.id}-reverse`;
    directionalIds.set(centerline.id, [forwardId, reverseId]);
    return [
      {...structuredClone(centerline), id: forwardId, direction: 'forward'},
      {...structuredClone(centerline), id: reverseId, direction: 'reverse'}
    ];
  });
  return {
    corridors,
    junctions: junctions.map((junction) => ({
      ...structuredClone(junction),
      corridors: junction.corridors.flatMap((corridorId) => directionalIds.get(corridorId) ?? [])
    }))
  };
}

function fitCorridorLaneOffsets(
  document: LevelEditorDocument,
  roadMask: Uint8Array,
  corridors: LaneCorridor[],
  junctions: readonly LaneJunction[]
): void {
  const candidates = [16.5, 16, 15, 14, 12, 10, 8];
  for (const corridor of corridors) {
    const desired = corridor.laneOffset ?? 16.5;
    const offsets = [desired, ...candidates.filter((candidate) => candidate < desired)];
    const desiredLaneCount = corridor.lanesPerDirection ?? 1;
    let accepted: {laneOffset: number; laneCount: number} | undefined;
    for (const laneCount of desiredLaneCount > 1 ? [desiredLaneCount, 1] : [1]) {
      const laneOffset = offsets.find((candidate) => corridorFitsRoad(
        document,
        roadMask,
        {...corridor, lanesPerDirection: laneCount, laneOffset: candidate},
        junctions
      ));
      if (laneOffset !== undefined) {
        accepted = {laneOffset, laneCount};
        break;
      }
    }
    corridor.lanesPerDirection = accepted?.laneCount ?? 1;
    corridor.laneOffset = accepted?.laneOffset ?? 8;
    corridor.clearanceConstrained = (
      corridor.lanesPerDirection < desiredLaneCount || corridor.laneOffset < 16.5
    );
  }
}

function corridorFitsRoad(
  document: LevelEditorDocument,
  roadMask: Uint8Array,
  corridor: LaneCorridor,
  junctions: readonly LaneJunction[]
): boolean {
  const relevantJunctions = junctions
    .filter((junction) => junction.corridors.includes(corridor.id))
    .map((junction) => ({...junction, corridors: [corridor.id]}));
  const compiled = compileLaneNetwork({
    laneOffset: 16.5,
    laneSpacing: 34,
    corridors: [corridor],
    junctions: relevantJunctions
  });
  return compiled.edges
    .filter((edge) => edge.kind === 'lane')
    .every((edge) => {
      const from = compiled.nodes.find((node) => node.id === edge.fromNodeId)!;
      const to = compiled.nodes.find((node) => node.id === edge.toNodeId)!;
      const samples = Math.max(1, Math.ceil(edge.length / 8));
      for (let index = 0; index <= samples; index++) {
        const progress = index / samples;
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;
        if (!roadFootprintFits(document, roadMask, x, y, 20)) return false;
      }
      return true;
    });
}

function roadFootprintFits(
  document: LevelEditorDocument,
  roadMask: Uint8Array,
  x: number,
  y: number,
  radius: number
): boolean {
  const diagonal = radius * Math.SQRT1_2;
  const samples = [
    {x, y},
    {x: x - radius, y}, {x: x + radius, y},
    {x, y: y - radius}, {x, y: y + radius},
    {x: x - diagonal, y: y - diagonal}, {x: x + diagonal, y: y - diagonal},
    {x: x - diagonal, y: y + diagonal}, {x: x + diagonal, y: y + diagonal}
  ];
  return samples.every((point) => {
    const tileX = Math.floor((point.x - document.map.origin.x) / document.map.tileSize);
    const tileY = Math.floor((point.y - document.map.origin.y) / document.map.tileSize);
    if (!inside(tileX, tileY, document.map.width, document.map.height)) return false;
    return Boolean(roadMask[indexOf(tileX, tileY, document.map.width)]);
  });
}

function classifyRoad(roadRadius: number, lengthTiles: number, terminal: boolean): LaneRoadClass {
  if (roadRadius >= 2) return 'arterial';
  if (roadRadius >= 1) return 'boulevard';
  if (terminal && lengthTiles <= 3.5) return 'alley';
  if (terminal && lengthTiles <= 7) return 'service';
  return 'street';
}

function roadClassSpeed(roadClass: LaneRoadClass): number {
  switch (roadClass) {
    case 'arterial': return 124;
    case 'boulevard': return 112;
    case 'street': return 96;
    case 'service': return 76;
    case 'alley': return 58;
  }
}

function roadClassPriority(roadClass: LaneRoadClass): number {
  switch (roadClass) {
    case 'arterial': return 1.25;
    case 'boulevard': return 1.15;
    case 'street': return 1;
    case 'service': return 0.84;
    case 'alley': return 0.68;
  }
}

function roadClassDensity(roadClass: LaneRoadClass): number {
  switch (roadClass) {
    case 'arterial': return 1.35;
    case 'boulevard': return 1.2;
    case 'street': return 1;
    case 'service': return 0.58;
    case 'alley': return 0.24;
  }
}

function preferredLaneCount(roadClass: LaneRoadClass, measuredHalfWidth: number): number {
  if ((roadClass === 'arterial' || roadClass === 'boulevard') && measuredHalfWidth >= 70) return 2;
  return 1;
}

function laneOffsetForWidth(measuredHalfWidth: number): number {
  return Math.max(16.5, Math.min(22, Math.floor(measuredHalfWidth - 16)));
}

function polylineLength(points: readonly TilePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function rebindRoadblocks(
  roadblocks: readonly LaneRoadblock[],
  corridors: readonly LaneCorridor[]
): LaneRoadblock[] {
  return roadblocks.flatMap((roadblock) => {
    const directions = roadblockDirections(roadblock);
    const blockedEdgeIds = directions.flatMap((direction) => {
      const nearest = nearestCorridorSegment(
        roadblock,
        corridors.filter((corridor) => corridor.direction === direction)
      );
      if (!nearest) return [];
      const lastSegmentIndex = nearest.corridor.points.length - 2;
      return Array.from({length: lastSegmentIndex + 1}, (_, segmentIndex) => (
        `${nearest.corridor.id}:${direction}:edge:${segmentIndex}`
      ));
    });
    if (blockedEdgeIds.length === 0) return [];
    return [{
      ...structuredClone(roadblock),
      blockedEdgeIds
    }];
  });
}

function roadblockDirections(roadblock: LaneRoadblock): Array<'forward' | 'reverse'> {
  const directions = new Set<'forward' | 'reverse'>();
  for (const edgeId of roadblock.blockedEdgeIds) {
    if (edgeId.includes(':forward:')) directions.add('forward');
    if (edgeId.includes(':reverse:')) directions.add('reverse');
  }
  return directions.size > 0 ? [...directions].sort() : ['forward', 'reverse'];
}

function nearestCorridorSegment(
  point: Point2D,
  corridors: readonly LaneCorridor[]
): {corridor: LaneCorridor; segmentIndex: number} | undefined {
  let nearest: {corridor: LaneCorridor; segmentIndex: number; distance: number} | undefined;
  for (const corridor of corridors) {
    for (let segmentIndex = 0; segmentIndex < corridor.points.length - 1; segmentIndex++) {
      const distance = pointToSegmentDistance(point, corridor.points[segmentIndex], corridor.points[segmentIndex + 1]);
      if (
        !nearest ||
        distance < nearest.distance ||
        distance === nearest.distance && corridor.id < nearest.corridor.id
      ) {
        nearest = {corridor, segmentIndex, distance};
      }
    }
  }
  return nearest && {corridor: nearest.corridor, segmentIndex: nearest.segmentIndex};
}

function connectedComponents(mask: Uint8Array, width: number, height: number): number[][] {
  const visited = new Uint8Array(mask.length);
  const components: number[][] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    const component: number[] = [];
    visited[start] = 1;
    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      const point = pointFromIndex(current, width);
      for (const offset of CARDINAL_NEIGHBORS) {
        const x = point.x + offset.x;
        const y = point.y + offset.y;
        if (!inside(x, y, width, height)) continue;
        const next = indexOf(x, y, width);
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components.sort((left, right) => right.length - left.length);
}

function thinRoadSurface(source: Uint8Array, width: number, height: number): Uint8Array {
  const mask = Uint8Array.from(source);
  let changed = true;
  let iteration = 0;
  while (changed && iteration++ < Math.max(width, height)) {
    changed = false;
    for (const phase of [0, 1] as const) {
      const removals: number[] = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const index = indexOf(x, y, width);
          if (!mask[index]) continue;
          const neighbors = EIGHT_NEIGHBORS.map((offset) => mask[indexOf(x + offset.x, y + offset.y, width)]);
          const count = neighbors.reduce((sum, value) => sum + value, 0);
          if (count < 2 || count > 6 || zeroToOneTransitions(neighbors) !== 1) continue;
          const [north, , east, , south, , west] = neighbors;
          const preservesConnectivity = phase === 0
            ? north * east * south === 0 && east * south * west === 0
            : north * east * west === 0 && north * south * west === 0;
          if (preservesConnectivity) removals.push(index);
        }
      }
      if (removals.length > 0) changed = true;
      for (const index of removals) mask[index] = 0;
    }
  }
  return mask;
}

function zeroToOneTransitions(neighbors: readonly number[]): number {
  let transitions = 0;
  for (let index = 0; index < neighbors.length; index++) {
    if (neighbors[index] === 0 && neighbors[(index + 1) % neighbors.length] === 1) transitions++;
  }
  return transitions;
}

function createSkeletonNeighborLookup(
  skeleton: Uint8Array,
  width: number,
  height: number
): (index: number) => number[] {
  return (index: number): number[] => {
    const point = pointFromIndex(index, width);
    const neighbors: number[] = [];
    for (const offset of EIGHT_NEIGHBORS) {
      const x = point.x + offset.x;
      const y = point.y + offset.y;
      if (!inside(x, y, width, height)) continue;
      const candidate = indexOf(x, y, width);
      if (!skeleton[candidate]) continue;
      if (
        offset.x !== 0 && offset.y !== 0 &&
        (skeleton[indexOf(point.x + offset.x, point.y, width)] || skeleton[indexOf(point.x, point.y + offset.y, width)])
      ) continue;
      neighbors.push(candidate);
    }
    return neighbors;
  };
}

function findNodeRegions(
  skeleton: Uint8Array,
  width: number,
  height: number,
  neighborsOf: (index: number) => number[]
): {regions: NodeRegion[]; regionByPixel: Int32Array} {
  const nodeMask = new Uint8Array(skeleton.length);
  for (let index = 0; index < skeleton.length; index++) {
    if (!skeleton[index] || neighborsOf(index).length === 2) continue;
    const point = pointFromIndex(index, width);
    for (let y = point.y - NODE_REGION_RADIUS; y <= point.y + NODE_REGION_RADIUS; y++) {
      for (let x = point.x - NODE_REGION_RADIUS; x <= point.x + NODE_REGION_RADIUS; x++) {
        if (inside(x, y, width, height) && skeleton[indexOf(x, y, width)]) nodeMask[indexOf(x, y, width)] = 1;
      }
    }
  }

  const regionByPixel = new Int32Array(skeleton.length);
  regionByPixel.fill(-1);
  const regions: NodeRegion[] = [];
  for (let start = 0; start < nodeMask.length; start++) {
    if (!nodeMask[start] || regionByPixel[start] >= 0) continue;
    const regionIndex = regions.length;
    const queue = [start];
    const pixels: number[] = [];
    regionByPixel[start] = regionIndex;
    while (queue.length > 0) {
      const current = queue.pop()!;
      pixels.push(current);
      for (const next of neighborsOf(current)) {
        if (!nodeMask[next] || regionByPixel[next] >= 0) continue;
        regionByPixel[next] = regionIndex;
        queue.push(next);
      }
    }
    const centroid = {
      x: pixels.reduce((sum, pixel) => sum + pointFromIndex(pixel, width).x, 0) / pixels.length,
      y: pixels.reduce((sum, pixel) => sum + pointFromIndex(pixel, width).y, 0) / pixels.length
    };
    regions.push({pixels, point: centroid});
  }
  return {regions, regionByPixel};
}

function traceCorridors(
  skeleton: Uint8Array,
  _width: number,
  _height: number,
  regions: readonly NodeRegion[],
  regionByPixel: Int32Array,
  neighborsOf: (index: number) => number[]
): TracedCorridor[] {
  const visitedEdges = new Set<string>();
  const corridors: TracedCorridor[] = [];
  for (let from = 0; from < regions.length; from++) {
    for (const pixel of regions[from].pixels) {
      for (const next of neighborsOf(pixel)) {
        if (regionByPixel[next] === from || visitedEdges.has(edgeKey(pixel, next))) continue;
        const path = [pixel, next];
        visitedEdges.add(edgeKey(pixel, next));
        let previous = pixel;
        let current = next;
        let to = regionByPixel[current];
        let guard = 0;
        while (to < 0 && guard++ < skeleton.length) {
          const candidates = neighborsOf(current).filter((candidate) => (
            candidate !== previous && !visitedEdges.has(edgeKey(current, candidate))
          ));
          if (candidates.length === 0) break;
          const following = candidates[0];
          visitedEdges.add(edgeKey(current, following));
          previous = current;
          current = following;
          path.push(current);
          to = regionByPixel[current];
        }
        if (to >= 0 && to !== from) corridors.push({from, to, pixels: path});
      }
    }
  }

  return corridors;
}

function simplifyPolyline(points: readonly TilePoint[], tolerance: number): TilePoint[] {
  const compact = points.filter((point, index) => (
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y
  ));
  if (compact.length <= 2) return [...compact];
  let furthestIndex = -1;
  let furthestDistance = tolerance;
  for (let index = 1; index < compact.length - 1; index++) {
    const distance = pointToSegmentDistance(compact[index], compact[0], compact.at(-1)!);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestIndex < 0) return [compact[0], compact.at(-1)!];
  return [
    ...simplifyPolyline(compact.slice(0, furthestIndex + 1), tolerance).slice(0, -1),
    ...simplifyPolyline(compact.slice(furthestIndex), tolerance)
  ];
}

function roadRadiusAt(mask: Uint8Array, width: number, height: number, point: TilePoint): number {
  const centerX = Math.round(point.x);
  const centerY = Math.round(point.y);
  for (let radius = 1; radius <= 4; radius++) {
    for (let offset = -radius; offset <= radius; offset++) {
      const candidates = [
        {x: centerX + offset, y: centerY - radius},
        {x: centerX + offset, y: centerY + radius},
        {x: centerX - radius, y: centerY + offset},
        {x: centerX + radius, y: centerY + offset}
      ];
      if (candidates.some(({x, y}) => !inside(x, y, width, height) || !mask[indexOf(x, y, width)])) return radius - 1;
    }
  }
  return 4;
}

function tileCenterToWorld(document: LevelEditorDocument, point: TilePoint): Point2D {
  return {
    x: document.map.origin.x + (point.x + 0.5) * document.map.tileSize,
    y: document.map.origin.y + (point.y + 0.5) * document.map.tileSize
  };
}

function pointToSegmentDistance(point: TilePoint, start: TilePoint, end: TilePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const progress = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function numberedId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function edgeKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function pointFromIndex(index: number, width: number): TilePoint {
  return {x: index % width, y: Math.floor(index / width)};
}

function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}

function inside(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export interface MapRoutePoint {
  x: number;
  y: number;
}

export interface MapRouteDocument {
  corridors: Array<{
    id: string;
    points: MapRoutePoint[];
  }>;
  junctions: Array<MapRoutePoint & {
    id: string;
    corridors: string[];
  }>;
}

interface RouteNode extends MapRoutePoint {
  neighbors: Set<number>;
}

const DEFAULT_GRID_SIZE = 4;
const DEFAULT_SAMPLE_SPACING = 192;

export class MapRoutePlanner {
  private readonly nodes: RouteNode[];
  private readonly anchors: number[];
  private readonly roadSectors: Set<string>;
  private readonly minimumX: number;
  private readonly maximumX: number;
  private readonly minimumY: number;
  private readonly maximumY: number;

  constructor(
    document: MapRouteDocument,
    private readonly gridSize = DEFAULT_GRID_SIZE,
    sampleSpacing = DEFAULT_SAMPLE_SPACING
  ) {
    if (!Number.isInteger(gridSize) || gridSize < 2) {
      throw new RangeError('Map route grid size must be an integer of at least 2.');
    }
    this.nodes = compileRouteNodes(document, sampleSpacing);
    if (this.nodes.length === 0) throw new RangeError('Map route document has no road points.');
    this.minimumX = Math.min(...this.nodes.map((node) => node.x));
    this.maximumX = Math.max(...this.nodes.map((node) => node.x));
    this.minimumY = Math.min(...this.nodes.map((node) => node.y));
    this.maximumY = Math.max(...this.nodes.map((node) => node.y));
    this.roadSectors = new Set(this.nodes.map((node) => this.sectorKey(node.x, node.y)));
    this.anchors = [...this.roadSectors]
      .sort()
      .map((sector) => this.nearestNodeToSectorCenter(sector));
  }

  get anchorCount(): number {
    return this.anchors.length;
  }

  get coverageSectorCount(): number {
    return this.roadSectors.size;
  }

  anchor(index: number): MapRoutePoint {
    const node = this.nodes[this.anchors[positiveModulo(index, this.anchors.length)]];
    return {x: node.x, y: node.y};
  }

  sectorAt(x: number, y: number): string | undefined {
    const margin = DEFAULT_SAMPLE_SPACING;
    if (
      x < this.minimumX - margin || x > this.maximumX + margin ||
      y < this.minimumY - margin || y > this.maximumY + margin
    ) return undefined;
    const key = this.sectorKey(x, y);
    return this.roadSectors.has(key) ? key : undefined;
  }

  routeToAnchor(x: number, y: number, anchorIndex: number): MapRoutePoint[] {
    const start = this.nearestNode(x, y);
    const target = this.anchors[positiveModulo(anchorIndex, this.anchors.length)];
    const previous = shortestPathTree(this.nodes, start, target);
    if (start !== target && previous[target] === -1) {
      throw new Error(`No authored road route from node ${start} to ${target}.`);
    }
    const route: number[] = [target];
    while (route[0] !== start) route.unshift(previous[route[0]]);
    return route.map((index) => ({x: this.nodes[index].x, y: this.nodes[index].y}));
  }

  private nearestNode(x: number, y: number): number {
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.nodes.length; index++) {
      const distance = squaredDistance(this.nodes[index], {x, y});
      if (distance >= nearestDistance) continue;
      nearest = index;
      nearestDistance = distance;
    }
    return nearest;
  }

  private nearestNodeToSectorCenter(sector: string): number {
    const [column, row] = sector.split(':').map(Number);
    const width = Math.max(1, this.maximumX - this.minimumX);
    const height = Math.max(1, this.maximumY - this.minimumY);
    const center = {
      x: this.minimumX + (column + 0.5) / this.gridSize * width,
      y: this.minimumY + (row + 0.5) / this.gridSize * height
    };
    const candidates = this.nodes
      .map((node, index) => ({node, index}))
      .filter(({node}) => this.sectorKey(node.x, node.y) === sector)
      .sort((left, right) => (
        squaredDistance(left.node, center) - squaredDistance(right.node, center) ||
        left.index - right.index
      ));
    return candidates[0].index;
  }

  private sectorKey(x: number, y: number): string {
    const width = Math.max(1, this.maximumX - this.minimumX);
    const height = Math.max(1, this.maximumY - this.minimumY);
    const column = Math.min(
      this.gridSize - 1,
      Math.max(0, Math.floor((x - this.minimumX) / width * this.gridSize))
    );
    const row = Math.min(
      this.gridSize - 1,
      Math.max(0, Math.floor((y - this.minimumY) / height * this.gridSize))
    );
    return `${column}:${row}`;
  }
}

function compileRouteNodes(document: MapRouteDocument, sampleSpacing: number): RouteNode[] {
  if (!Number.isFinite(sampleSpacing) || sampleSpacing <= 0) {
    throw new RangeError('Map route sample spacing must be positive.');
  }
  const nodes: RouteNode[] = [];
  const nodeByPoint = new Map<string, number>();
  const nodeFor = (point: MapRoutePoint): number => {
    const key = `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;
    const existing = nodeByPoint.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push({x: point.x, y: point.y, neighbors: new Set()});
    nodeByPoint.set(key, index);
    return index;
  };

  for (const corridor of [...document.corridors].sort((left, right) => left.id.localeCompare(right.id))) {
    if (corridor.points.length < 2) continue;
    const controls = [
      ...corridor.points,
      ...document.junctions
        .filter((junction) => junction.corridors.includes(corridor.id))
        .map(({x, y}) => ({x, y}))
    ]
      .map((point) => ({point, station: stationAlongPolyline(corridor.points, point)}))
      .sort((left, right) => left.station - right.station ||
        left.point.x - right.point.x || left.point.y - right.point.y)
      .filter((entry, index, entries) => (
        index === 0 || squaredDistance(entry.point, entries[index - 1].point) > 0.001
      ));
    let previous: number | undefined;
    for (let controlIndex = 0; controlIndex < controls.length - 1; controlIndex++) {
      const from = controls[controlIndex].point;
      const to = controls[controlIndex + 1].point;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / sampleSpacing));
      for (let step = 0; step <= steps; step++) {
        if (controlIndex > 0 && step === 0) continue;
        const progress = step / steps;
        const current = nodeFor({
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress
        });
        if (previous !== undefined && previous !== current) {
          nodes[previous].neighbors.add(current);
          nodes[current].neighbors.add(previous);
        }
        previous = current;
      }
    }
  }
  return nodes;
}

function stationAlongPolyline(points: readonly MapRoutePoint[], point: MapRoutePoint): number {
  let station = 0;
  let bestStation = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (
      (point.x - from.x) * dx + (point.y - from.y) * dy
    ) / lengthSquared));
    const projected = {x: from.x + dx * progress, y: from.y + dy * progress};
    const distance = squaredDistance(point, projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStation = station + Math.sqrt(lengthSquared) * progress;
    }
    station += Math.sqrt(lengthSquared);
  }
  return bestStation;
}

function shortestPathTree(nodes: readonly RouteNode[], start: number, target: number): Int32Array {
  const distances = new Float64Array(nodes.length).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(nodes.length).fill(-1);
  const visited = new Uint8Array(nodes.length);
  distances[start] = 0;
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < nodes.length; index++) {
      if (!visited[index] && distances[index] < currentDistance) {
        current = index;
        currentDistance = distances[index];
      }
    }
    if (current === -1 || current === target) break;
    visited[current] = 1;
    for (const neighbor of nodes[current].neighbors) {
      const candidate = currentDistance + Math.sqrt(squaredDistance(nodes[current], nodes[neighbor]));
      if (candidate >= distances[neighbor]) continue;
      distances[neighbor] = candidate;
      previous[neighbor] = current;
    }
  }
  return previous;
}

function squaredDistance(left: MapRoutePoint, right: MapRoutePoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function positiveModulo(value: number, modulus: number): number {
  return (value % modulus + modulus) % modulus;
}

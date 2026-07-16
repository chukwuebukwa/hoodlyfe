import {
  POPULATION_INTEREST,
  type PopulationInterestAnchor
} from './population-activation-policy.ts';

export const POPULATION_INTEREST_CLUSTERING = Object.freeze({
  linkRadius: POPULATION_INTEREST.retentionRadius * 2
});

export interface PopulationInterestCluster {
  id: string;
  memberIds: readonly string[];
  anchors: readonly PopulationInterestAnchor[];
}

export interface PopulationInterestClusterQuota {
  cluster: PopulationInterestCluster;
  quota: number;
}

export interface NearestPopulationInterestCluster {
  cluster: PopulationInterestCluster;
  distance: number;
}

export function populationInterestClusters(
  anchors: readonly PopulationInterestAnchor[]
): PopulationInterestCluster[] {
  const normalized = anchors
    .filter(validAnchor)
    .map(cloneAnchor)
    .sort(compareAnchor);
  const seeds = normalized.filter((anchor) => anchor.kind !== 'lookahead');
  if (seeds.length === 0) return [];

  const parents = seeds.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parents[current] !== current) current = parents[current];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = current;
      index = next;
    }
    return current;
  };
  const unite = (left: number, right: number): void => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot === rightRoot) return;
    parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };

  for (let left = 0; left < seeds.length; left++) {
    for (let right = left + 1; right < seeds.length; right++) {
      if (anchorDistance(seeds[left], seeds[right]) <= POPULATION_INTEREST_CLUSTERING.linkRadius) {
        unite(left, right);
      }
    }
  }

  const grouped = new Map<number, PopulationInterestAnchor[]>();
  for (let index = 0; index < seeds.length; index++) {
    const key = root(index);
    const group = grouped.get(key) ?? [];
    group.push(seeds[index]);
    grouped.set(key, group);
  }

  const drafts = [...grouped.values()].map((group) => {
    const memberIds = [...new Set(group.map(anchorMemberId))].sort();
    return {
      id: `cluster:${memberIds.join('+')}`,
      memberIds,
      anchors: [...group].sort(compareAnchor)
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  for (const anchor of normalized.filter((candidate) => candidate.kind === 'lookahead')) {
    const owned = anchor.ownerId
      ? drafts.find((cluster) => cluster.memberIds.includes(anchor.ownerId as string))
      : undefined;
    const target = owned ?? nearestDraft(anchor.x, anchor.y, drafts);
    if (target) target.anchors.push(anchor);
  }

  return drafts.map((draft) => ({
    id: draft.id,
    memberIds: Object.freeze([...draft.memberIds]),
    anchors: Object.freeze([...draft.anchors].sort(compareAnchor))
  }));
}

export function populationInterestClusterQuotas(
  clusters: readonly PopulationInterestCluster[],
  capacity: number
): PopulationInterestClusterQuota[] {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError('Population cluster capacity must be a non-negative integer.');
  }
  const ordered = [...clusters].sort((left, right) => left.id.localeCompare(right.id));
  if (ordered.length === 0) return [];
  const base = Math.floor(capacity / ordered.length);
  const remainder = capacity % ordered.length;
  return ordered.map((cluster, index) => ({
    cluster,
    quota: base + (index < remainder ? 1 : 0)
  }));
}

export function nearestPopulationInterestCluster(
  x: number,
  y: number,
  clusters: readonly PopulationInterestCluster[]
): NearestPopulationInterestCluster | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  let nearest: NearestPopulationInterestCluster | undefined;
  for (const cluster of clusters) {
    let distance = Number.POSITIVE_INFINITY;
    for (const anchor of cluster.anchors) {
      distance = Math.min(distance, Math.hypot(anchor.x - x, anchor.y - y));
    }
    if (
      !nearest ||
      distance < nearest.distance ||
      (distance === nearest.distance && cluster.id.localeCompare(nearest.cluster.id) < 0)
    ) nearest = {cluster, distance};
  }
  return nearest;
}

function nearestDraft<T extends {id: string; anchors: readonly PopulationInterestAnchor[]}>(
  x: number,
  y: number,
  clusters: readonly T[]
): T | undefined {
  let nearest: {cluster: T; distance: number} | undefined;
  for (const cluster of clusters) {
    const distance = Math.min(...cluster.anchors.map((anchor) => Math.hypot(anchor.x - x, anchor.y - y)));
    if (
      !nearest ||
      distance < nearest.distance ||
      (distance === nearest.distance && cluster.id.localeCompare(nearest.cluster.id) < 0)
    ) nearest = {cluster, distance};
  }
  return nearest?.cluster;
}

function anchorMemberId(anchor: PopulationInterestAnchor): string {
  return anchor.ownerId?.trim() ||
    `${anchor.kind ?? 'player'}@${coordinateKey(anchor.x)},${coordinateKey(anchor.y)}`;
}

function coordinateKey(value: number): string {
  return value.toFixed(3);
}

function compareAnchor(left: PopulationInterestAnchor, right: PopulationInterestAnchor): number {
  return anchorMemberId(left).localeCompare(anchorMemberId(right)) ||
    (left.kind ?? 'player').localeCompare(right.kind ?? 'player') ||
    left.x - right.x || left.y - right.y;
}

function anchorDistance(left: PopulationInterestAnchor, right: PopulationInterestAnchor): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function validAnchor(anchor: PopulationInterestAnchor): boolean {
  return Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
}

function cloneAnchor(anchor: PopulationInterestAnchor): PopulationInterestAnchor {
  return {
    x: anchor.x,
    y: anchor.y,
    kind: anchor.kind,
    protectsVisibility: anchor.protectsVisibility,
    ownerId: anchor.ownerId
  };
}

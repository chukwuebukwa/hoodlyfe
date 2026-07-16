import {
  populationInterestClusterQuotas,
  type PopulationInterestCluster
} from './population-interest-cluster-policy.ts';

export interface PopulationClusterCandidate {
  clusterId: string;
}

export interface PopulationClusterCapacityPlan {
  quotaByCluster: ReadonlyMap<string, number>;
  reliefNeeded: number;
  pressuredClusterIds: ReadonlySet<string>;
}

export function populationClusterCapacityPlan(
  clusters: readonly PopulationInterestCluster[],
  capacity: number,
  activeCounts: ReadonlyMap<string, number>,
  demandCounts: ReadonlyMap<string, number>
): PopulationClusterCapacityPlan {
  const quotas = populationInterestClusterQuotas(clusters, capacity);
  const quotaByCluster = new Map(quotas.map(({cluster, quota}) => [cluster.id, quota]));
  const pressuredClusterIds = new Set<string>();
  let required = 0;
  for (const {cluster, quota} of quotas) {
    const missing = Math.max(0, quota - (activeCounts.get(cluster.id) ?? 0));
    const demand = demandCounts.get(cluster.id) ?? 0;
    if (missing > 0 && demand > 0) pressuredClusterIds.add(cluster.id);
    required += Math.min(missing, demand);
  }
  const active = [...activeCounts.values()].reduce((total, count) => total + count, 0);
  const free = Math.max(0, capacity - active);
  return {
    quotaByCluster,
    reliefNeeded: Math.max(0, required - free),
    pressuredClusterIds
  };
}

export function fairPopulationCandidateOrder<T extends PopulationClusterCandidate>(
  clusters: readonly PopulationInterestCluster[],
  capacity: number,
  activeCounts: ReadonlyMap<string, number>,
  candidates: readonly T[]
): T[] {
  const quotas = populationInterestClusterQuotas(clusters, capacity);
  const counts = new Map(activeCounts);
  const candidatesByCluster = groupCandidatesByCluster(candidates);
  const ordered: T[] = [];

  let progress = true;
  while (progress) {
    progress = false;
    for (const {cluster, quota} of quotas) {
      const active = counts.get(cluster.id) ?? 0;
      if (active >= quota) continue;
      const candidate = candidatesByCluster.get(cluster.id)?.shift();
      if (!candidate) continue;
      ordered.push(candidate);
      counts.set(cluster.id, active + 1);
      progress = true;
    }
  }

  progress = true;
  while (progress) {
    progress = false;
    for (const {cluster} of quotas) {
      const candidate = candidatesByCluster.get(cluster.id)?.shift();
      if (!candidate) continue;
      ordered.push(candidate);
      progress = true;
    }
  }
  return ordered;
}

function groupCandidatesByCluster<T extends PopulationClusterCandidate>(
  candidates: readonly T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.clusterId) ?? [];
    group.push(candidate);
    grouped.set(candidate.clusterId, group);
  }
  return grouped;
}

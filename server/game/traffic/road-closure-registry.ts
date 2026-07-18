export interface RoadClosureDiagnostic {
  revision: number;
  ownerId: string;
  edgeIds: string[];
}

/** Owns dynamic lane-edge admission without owning the actors that requested it. */
export class RoadClosureRegistry {
  private readonly edgeIdsByOwner = new Map<string, Set<string>>();
  private readonly ownerIdsByEdge = new Map<string, Set<string>>();
  private currentRevision = 0;

  get revision(): number {
    return this.currentRevision;
  }

  acquire(ownerId: string, edgeIds: readonly string[]): void {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) throw new Error('Road closure owner id must be non-empty.');
    const normalizedEdgeIds = [...new Set(edgeIds.map((edgeId) => edgeId.trim()).filter(Boolean))]
      .sort();
    if (normalizedEdgeIds.length === 0) {
      throw new Error(`Road closure ${normalizedOwnerId} requires at least one edge.`);
    }
    const previous = this.edgeIdsByOwner.get(normalizedOwnerId);
    if (previous && sameIds(previous, normalizedEdgeIds)) return;
    if (previous) this.release(normalizedOwnerId);
    const owned = new Set(normalizedEdgeIds);
    this.edgeIdsByOwner.set(normalizedOwnerId, owned);
    for (const edgeId of owned) {
      const owners = this.ownerIdsByEdge.get(edgeId) ?? new Set<string>();
      owners.add(normalizedOwnerId);
      this.ownerIdsByEdge.set(edgeId, owners);
    }
    this.currentRevision++;
  }

  release(ownerId: string): boolean {
    const owned = this.edgeIdsByOwner.get(ownerId);
    if (!owned) return false;
    this.edgeIdsByOwner.delete(ownerId);
    for (const edgeId of owned) {
      const owners = this.ownerIdsByEdge.get(edgeId);
      owners?.delete(ownerId);
      if (owners?.size === 0) this.ownerIdsByEdge.delete(edgeId);
    }
    this.currentRevision++;
    return true;
  }

  isClosed(edgeId: string): boolean {
    return (this.ownerIdsByEdge.get(edgeId)?.size ?? 0) > 0;
  }

  owns(ownerId: string): boolean {
    return this.edgeIdsByOwner.has(ownerId);
  }

  closedEdgeIds(): string[] {
    return [...this.ownerIdsByEdge.keys()].sort();
  }

  diagnostics(): RoadClosureDiagnostic[] {
    return [...this.edgeIdsByOwner.entries()]
      .map(([ownerId, edgeIds]) => ({
        revision: this.currentRevision,
        ownerId,
        edgeIds: [...edgeIds].sort()
      }))
      .sort((left, right) => left.ownerId.localeCompare(right.ownerId));
  }
}

function sameIds(left: ReadonlySet<string>, right: readonly string[]): boolean {
  if (left.size !== right.length) return false;
  return right.every((edgeId) => left.has(edgeId));
}

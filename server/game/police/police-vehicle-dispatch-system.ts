import type {PoliceVehicleTargetSnapshot} from './crime-response-controller.ts';

export class PoliceVehicleDispatchSystem {
  private readonly assignments = new Map<string, string>();
  private readonly ignoredReports = new Map<string, number>();

  targetFor(
    vehicleId: string,
    vehicleX: number,
    vehicleY: number,
    targets: readonly PoliceVehicleTargetSnapshot[]
  ): PoliceVehicleTargetSnapshot | undefined {
    const assignedSuspectId = this.assignments.get(vehicleId);
    const assigned = targets.find((target) => target.suspectId === assignedSuspectId);
    if (assigned) return assigned;
    this.assignments.delete(vehicleId);

    const assignmentCounts = this.assignmentCounts(vehicleId);
    const selected = [...targets]
      .filter((target) => (
        target.reportedAt > (this.ignoredReports.get(target.suspectId) ?? -1) &&
        (assignmentCounts.get(target.suspectId) ?? 0) < responseLimit(target.wantedLevel)
      ))
      .sort((left, right) => (
        right.wantedLevel - left.wantedLevel ||
        Math.hypot(left.reportedX - vehicleX, left.reportedY - vehicleY) -
          Math.hypot(right.reportedX - vehicleX, right.reportedY - vehicleY) ||
        left.suspectId.localeCompare(right.suspectId)
      ))[0];
    if (selected) this.assignments.set(vehicleId, selected.suspectId);
    return selected;
  }

  forget(vehicleId: string, suspectId: string, reportAt: number): void {
    if (this.assignments.get(vehicleId) === suspectId) this.assignments.delete(vehicleId);
    this.ignoredReports.set(suspectId, Math.max(
      reportAt,
      this.ignoredReports.get(suspectId) ?? -1
    ));
  }

  release(vehicleId: string): void {
    this.assignments.delete(vehicleId);
  }

  private assignmentCounts(excludedVehicleId: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [vehicleId, suspectId] of this.assignments) {
      if (vehicleId === excludedVehicleId) continue;
      counts.set(suspectId, (counts.get(suspectId) ?? 0) + 1);
    }
    return counts;
  }
}

function responseLimit(wantedLevel: number): number {
  return Math.max(1, Math.min(3, Math.floor(wantedLevel)));
}

import type {Incident} from './incident-registry.ts';

export type WitnessKind = 'civilian' | 'police';

export interface WitnessCandidate {
  id: string;
  kind: WitnessKind;
  x: number;
  y: number;
  alive: boolean;
}

export interface WitnessReport {
  witnessId: string;
  witnessKind: WitnessKind;
  delayMs: number;
  lineOfSight: boolean;
  distance: number;
}

interface RankedWitness extends WitnessReport {
  priority: number;
}

export class WitnessSystem {
  selectReporter(
    incident: Incident,
    candidates: readonly WitnessCandidate[],
    hasLineOfSight: (fromX: number, fromY: number, toX: number, toY: number) => boolean
  ): WitnessReport | undefined {
    const reports: RankedWitness[] = [];
    for (const candidate of candidates) {
      if (!candidate.alive || candidate.id === incident.suspectId) {
        continue;
      }
      const distance = Math.hypot(candidate.x - incident.x, candidate.y - incident.y);
      const lineOfSight = distance <= 720 && hasLineOfSight(
        candidate.x,
        candidate.y,
        incident.x,
        incident.y
      );
      const hearingRange = candidate.kind === 'police' ? 760 : 460;
      if (!lineOfSight && distance > hearingRange) continue;

      const delayMs = candidate.kind === 'police'
        ? (lineOfSight ? 120 : 520)
        : (lineOfSight ? 850 : 1450);
      reports.push({
        witnessId: candidate.id,
        witnessKind: candidate.kind,
        delayMs,
        lineOfSight,
        distance,
        priority: (candidate.kind === 'police' ? 0 : 2) + (lineOfSight ? 0 : 1)
      });
    }

    reports.sort((left, right) => (
      left.priority - right.priority ||
      left.distance - right.distance ||
      left.witnessId.localeCompare(right.witnessId)
    ));
    const selected = reports[0];
    if (!selected) return undefined;
    const {priority: _priority, ...report} = selected;
    return report;
  }
}

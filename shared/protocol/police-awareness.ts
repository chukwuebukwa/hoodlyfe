export const POLICE_AWARENESS_MESSAGE = 'police.awareness';

export type PoliceAwarenessPhase = 'clear' | 'spotted' | 'searching';
export type PoliceSearchUnitKind = 'foot' | 'vehicle' | 'helicopter';

export interface PoliceSearchZone {
  id: string;
  unitId: string;
  unitKind: PoliceSearchUnitKind;
  x: number;
  y: number;
  angle: number;
  range: number;
  halfAngle: number;
}

export interface PoliceAwarenessMessage {
  phase: PoliceAwarenessPhase;
  wantedLevel: number;
  lastKnownX: number;
  lastKnownY: number;
  lastSeenAt: number;
  searchStartedAt: number;
  zones: PoliceSearchZone[];
}

export function clearPoliceAwareness(): PoliceAwarenessMessage {
  return {
    phase: 'clear',
    wantedLevel: 0,
    lastKnownX: 0,
    lastKnownY: 0,
    lastSeenAt: 0,
    searchStartedAt: 0,
    zones: []
  };
}

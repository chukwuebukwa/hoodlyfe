import type {
  PoliceSearchUnitKind,
  PoliceSearchZone
} from '../../../shared/protocol/police-awareness.ts';

export const POLICE_AWARENESS = Object.freeze({
  lostSightGraceMs: 750,
  foot: Object.freeze({
    range: 620,
    closeAwarenessRadius: 62,
    halfAngle: Math.PI * 0.34
  }),
  vehicle: Object.freeze({
    range: 760,
    closeAwarenessRadius: 82,
    halfAngle: Math.PI * 0.28
  }),
  helicopter: Object.freeze({
    range: 900,
    closeAwarenessRadius: 112,
    halfAngle: Math.PI * 0.16
  })
});

export interface PoliceVisionPose {
  x: number;
  y: number;
  angle: number;
}

export function policeFieldOfViewContains(
  kind: PoliceSearchUnitKind,
  unit: PoliceVisionPose,
  target: {x: number; y: number}
): boolean {
  const policy = POLICE_AWARENESS[kind];
  const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
  if (distance > policy.range) return false;
  if (distance <= policy.closeAwarenessRadius) return true;
  const targetAngle = Math.atan2(target.y - unit.y, target.x - unit.x);
  return Math.abs(shortestAngle(targetAngle - unit.angle)) <= policy.halfAngle;
}

export function policeSearchZone(
  kind: PoliceSearchUnitKind,
  unitId: string,
  pose: PoliceVisionPose
): PoliceSearchZone {
  const policy = POLICE_AWARENESS[kind];
  return {
    id: `${kind}:${unitId}`,
    unitId,
    unitKind: kind,
    x: pose.x,
    y: pose.y,
    angle: pose.angle,
    range: policy.range,
    halfAngle: policy.halfAngle
  };
}

function shortestAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

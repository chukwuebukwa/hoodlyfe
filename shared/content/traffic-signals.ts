import {districtPoint} from './district-map-frame.ts';

export type TrafficAxis = 'north-south' | 'east-west';
export type TrafficSignalPhase = 'green' | 'yellow' | 'red';

export interface TrafficSignalApproachDefinition {
  id: string;
  axis: TrafficAxis;
  stopX: number;
  stopY: number;
  directionX: number;
  directionY: number;
  corridorHalfWidth: number;
}

export interface TrafficSignalDefinition {
  id: string;
  label: string;
  x: number;
  y: number;
  intersectionHalfWidth: number;
  intersectionHalfHeight: number;
  approaches: readonly TrafficSignalApproachDefinition[];
}

export interface TrafficSignalPhaseSnapshot {
  northSouth: TrafficSignalPhase;
  eastWest: TrafficSignalPhase;
  nextChangeAt: number;
}

export const TRAFFIC_SIGNAL_CYCLE_MS = 16_000;
export const TRAFFIC_SIGNAL_APPROACH_DISTANCE = 360;

export const TRAFFIC_SIGNALS: readonly TrafficSignalDefinition[] = Object.freeze([
  Object.freeze({
    id: 'foundry-crossing',
    label: 'Foundry Crossing',
    ...districtPoint(2400, 960),
    intersectionHalfWidth: 120,
    intersectionHalfHeight: 72,
    approaches: Object.freeze([
      approach('northbound', 'north-south', 2400, 1088, 0, -1, 118),
      approach('southbound', 'north-south', 2400, 832, 0, 1, 118),
      approach('eastbound', 'east-west', 2176, 960, 1, 0, 56),
      approach('westbound', 'east-west', 2560, 960, -1, 0, 56)
    ])
  }),
  Object.freeze({
    id: 'threads-junction',
    label: 'Threads Junction',
    ...districtPoint(2400, 2112),
    intersectionHalfWidth: 120,
    intersectionHalfHeight: 120,
    approaches: Object.freeze([
      approach('northbound', 'north-south', 2400, 2304, 0, -1, 118),
      approach('southbound', 'north-south', 2400, 1920, 0, 1, 118),
      approach('westbound', 'east-west', 2624, 2112, -1, 0, 118)
    ])
  })
]);

export function trafficSignalPhasesAt(nowMs: number): TrafficSignalPhaseSnapshot {
  const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
  const cycleStart = Math.floor(safeNow / TRAFFIC_SIGNAL_CYCLE_MS) * TRAFFIC_SIGNAL_CYCLE_MS;
  const elapsed = safeNow - cycleStart;
  if (elapsed < 5000) {
    return {northSouth: 'green', eastWest: 'red', nextChangeAt: cycleStart + 5000};
  }
  if (elapsed < 6000) {
    return {northSouth: 'yellow', eastWest: 'red', nextChangeAt: cycleStart + 6000};
  }
  if (elapsed < 11_000) {
    return {northSouth: 'red', eastWest: 'green', nextChangeAt: cycleStart + 11_000};
  }
  if (elapsed < 12_000) {
    return {northSouth: 'red', eastWest: 'yellow', nextChangeAt: cycleStart + 12_000};
  }
  return {
    northSouth: 'red',
    eastWest: 'red',
    nextChangeAt: cycleStart + TRAFFIC_SIGNAL_CYCLE_MS
  };
}

export function phaseForAxis(
  phases: TrafficSignalPhaseSnapshot,
  axis: TrafficAxis
): TrafficSignalPhase {
  return axis === 'north-south' ? phases.northSouth : phases.eastWest;
}

function approach(
  id: string,
  axis: TrafficAxis,
  stopX: number,
  stopY: number,
  directionX: number,
  directionY: number,
  corridorHalfWidth: number
): Readonly<TrafficSignalApproachDefinition> {
  const stop = districtPoint(stopX, stopY);
  return Object.freeze({
    id,
    axis,
    stopX: stop.x,
    stopY: stop.y,
    directionX,
    directionY,
    corridorHalfWidth
  });
}

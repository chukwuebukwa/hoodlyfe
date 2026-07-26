/**
 * Thin shim over the engine's swept oriented-box time-of-impact. The math
 * originally lived here and was ported verbatim into engine/geometry/sweep.ts;
 * the engine copy is now canonical.
 */

import {sweptOrientedBoxTimeToContact as engineSweptOrientedBoxTimeToContact} from '../../../engine/geometry/sweep';

export interface TrafficMotionBox {
  x: number;
  y: number;
  angle: number;
  velocityX: number;
  velocityY: number;
  halfLength: number;
  halfWidth: number;
}

/**
 * Finds the first overlap time for two oriented boxes translating at constant velocity.
 * Rotation is held fixed over the short traffic-awareness horizon.
 */
export function sweptOrientedBoxTimeToContact(
  left: TrafficMotionBox,
  right: TrafficMotionBox,
  horizonSeconds: number,
  margin = 0
): number | undefined {
  return engineSweptOrientedBoxTimeToContact(
    {kind: 'box', ...left},
    {kind: 'box', ...right},
    horizonSeconds,
    margin
  );
}

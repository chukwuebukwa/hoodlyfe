/** fast-check generators for engine shapes and poses. */

import fc from 'fast-check';
import type {PosedBox, PosedCircle} from '../geometry/overlap';
import type {MotionBox, MotionCircle} from '../geometry/sweep';

const coordinate = fc.double({min: -2000, max: 2000, noNaN: true, noDefaultInfinity: true});
const angle = fc.double({min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true});
const radius = fc.double({min: 1, max: 80, noNaN: true, noDefaultInfinity: true});
const extent = fc.double({min: 2, max: 120, noNaN: true, noDefaultInfinity: true});
const velocity = fc.double({min: -1200, max: 1200, noNaN: true, noDefaultInfinity: true});

export const posedCircle: fc.Arbitrary<PosedCircle> = fc.record({
  kind: fc.constant('circle' as const),
  x: coordinate,
  y: coordinate,
  angle: fc.constant(0),
  radius,
});

export const posedBox: fc.Arbitrary<PosedBox> = fc.record({
  kind: fc.constant('box' as const),
  x: coordinate,
  y: coordinate,
  angle,
  halfLength: extent,
  halfWidth: extent,
});

export const motionCircle: fc.Arbitrary<MotionCircle> = posedCircle.chain((c) =>
  fc.record({velocityX: velocity, velocityY: velocity}).map((v) => ({...c, ...v}))
);

export const motionBox: fc.Arbitrary<MotionBox> = posedBox.chain((b) =>
  fc.record({velocityX: velocity, velocityY: velocity}).map((v) => ({...b, ...v}))
);

export const segment = fc.record({
  ax: coordinate,
  ay: coordinate,
  bx: coordinate,
  by: coordinate,
});

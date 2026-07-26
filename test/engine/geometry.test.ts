import assert from 'node:assert/strict';
import {test} from 'node:test';
import fc from 'fast-check';
import {
  boxesOverlap,
  circleBoxOverlap,
  circlesOverlap,
  shapesOverlap,
  shapeAabb,
  pointInBox,
} from '../../engine/geometry/overlap';
import {closestPointOnSegment, closestPointOnBox, distanceToBox} from '../../engine/geometry/closest';
import {segmentVsBox, segmentVsCircle} from '../../engine/geometry/raycast';
import {traceGrid} from '../../engine/geometry/grid-trace';
import {
  sweptCircleTimeToContact,
  sweptOrientedBoxTimeToContact,
} from '../../engine/geometry/sweep';
import {boxBoxManifold, boxCircleManifold, circleCircleManifold} from '../../engine/geometry/manifold';
import {motionBox, motionCircle, posedBox, posedCircle, segment} from '../../engine/testing/arbitraries';

const FC_RUNS = {numRuns: 300, seed: 1337};

test('overlap tests are symmetric', () => {
  fc.assert(
    fc.property(posedBox, posedBox, (a, b) => boxesOverlap(a, b) === boxesOverlap(b, a)),
    FC_RUNS
  );
  fc.assert(
    fc.property(posedCircle, posedCircle, (a, b) => circlesOverlap(a, b) === circlesOverlap(b, a)),
    FC_RUNS
  );
  fc.assert(
    fc.property(posedCircle, posedBox, (c, b) => shapesOverlap(c, b) === shapesOverlap(b, c)),
    FC_RUNS
  );
});

test('shapeAabb contains the shape (sampled boundary points)', () => {
  fc.assert(
    fc.property(posedBox, (box) => {
      const bounds = shapeAabb(box);
      // All four corners must be inside the AABB.
      for (const sign of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const c = Math.cos(box.angle);
        const s = Math.sin(box.angle);
        const px = box.x + c * box.halfLength * sign[0] - s * box.halfWidth * sign[1];
        const py = box.y + s * box.halfLength * sign[0] + c * box.halfWidth * sign[1];
        if (px < bounds.minX - 1e-6 || px > bounds.maxX + 1e-6) return false;
        if (py < bounds.minY - 1e-6 || py > bounds.maxY + 1e-6) return false;
      }
      return true;
    }),
    FC_RUNS
  );
});

test('closestPointOnSegment lies on the segment and minimizes distance', () => {
  fc.assert(
    fc.property(segment, fc.double({min: -500, max: 500, noNaN: true}), fc.double({min: -500, max: 500, noNaN: true}), (seg, px, py) => {
      const closest = closestPointOnSegment(seg.ax, seg.ay, seg.bx, seg.by, px, py);
      if (closest.t < 0 || closest.t > 1) return false;
      const bestSq = (closest.x - px) ** 2 + (closest.y - py) ** 2;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const sx = seg.ax + (seg.bx - seg.ax) * t;
        const sy = seg.ay + (seg.by - seg.ay) * t;
        if ((sx - px) ** 2 + (sy - py) ** 2 < bestSq - 1e-6 * Math.max(1, bestSq)) return false;
      }
      return true;
    }),
    FC_RUNS
  );
});

test('closestPointOnBox agrees with circleBoxOverlap', () => {
  fc.assert(
    fc.property(posedBox, posedCircle, (box, circle) => {
      const overlap = circleBoxOverlap(circle, box);
      const distance = distanceToBox(box, circle.x, circle.y);
      return overlap === (distance <= circle.radius + 1e-9);
    }),
    FC_RUNS
  );
});

test('segmentVsCircle hit lies on the circle boundary (outside starts)', () => {
  fc.assert(
    fc.property(segment, posedCircle, (seg, circle) => {
      const hit = segmentVsCircle(seg.ax, seg.ay, seg.bx, seg.by, circle);
      if (!hit || hit.t === 0) return true;
      const dist = Math.hypot(hit.x - circle.x, hit.y - circle.y);
      return Math.abs(dist - circle.radius) < 1e-6 * Math.max(1, circle.radius);
    }),
    FC_RUNS
  );
});

test('segmentVsBox hit lies on the box boundary and normal opposes the ray', () => {
  fc.assert(
    fc.property(segment, posedBox, (seg, box) => {
      const hit = segmentVsBox(seg.ax, seg.ay, seg.bx, seg.by, box);
      if (!hit || hit.t === 0) return true;
      const d = distanceToBox(box, hit.x, hit.y);
      if (d > 1e-5) return false;
      const dirDot = hit.normalX * (seg.bx - seg.ax) + hit.normalY * (seg.by - seg.ay);
      return dirDot <= 1e-9;
    }),
    FC_RUNS
  );
});

test('traceGrid agrees with brute-force fine marching', () => {
  const tile = 64;
  fc.assert(
    fc.property(
      fc.record({
        ax: fc.double({min: 0, max: 640, noNaN: true}),
        ay: fc.double({min: 0, max: 640, noNaN: true}),
        bx: fc.double({min: 0, max: 640, noNaN: true}),
        by: fc.double({min: 0, max: 640, noNaN: true}),
        blockedMask: fc.array(fc.boolean(), {minLength: 100, maxLength: 100}),
      }),
      ({ax, ay, bx, by, blockedMask}) => {
        const isBlocked = (col: number, row: number) => {
          if (col < 0 || row < 0 || col >= 10 || row >= 10) return true;
          return blockedMask[row * 10 + col];
        };
        const hit = traceGrid(ax, ay, bx, by, isBlocked, tile, tile);
        // Brute force: march at 0.25px resolution.
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(len / 0.25));
        let bruteT: number | undefined;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          if (isBlocked(Math.floor((ax + dx * t) / tile), Math.floor((ay + dy * t) / tile))) {
            bruteT = t;
            break;
          }
        }
        if (bruteT === undefined) return hit === undefined;
        if (hit === undefined) return false;
        // DDA is exact; brute-force marching overshoots by up to one step.
        return hit.t <= bruteT + 1e-9 && bruteT - hit.t <= (0.3 / Math.max(len, 1)) + 1e-6;
      }
    ),
    {numRuns: 200, seed: 42}
  );
});

test('swept circle TOI is consistent with overlap at the contact time', () => {
  fc.assert(
    fc.property(motionCircle, motionCircle, (a, b) => {
      const toi = sweptCircleTimeToContact(a, b, 1);
      if (toi === undefined || toi === 0) return true;
      const at = (m: typeof a, t: number) => ({...m, x: m.x + m.velocityX * t, y: m.y + m.velocityY * t});
      // Just after contact they overlap (with tolerance); just before they don't.
      const after = circlesOverlap(at(a, Math.min(1, toi + 1e-4)), at(b, Math.min(1, toi + 1e-4)), 1e-2);
      const before = !circlesOverlap(at(a, toi * 0.5), at(b, toi * 0.5), -1e-2);
      return after && before;
    }),
    FC_RUNS
  );
});

test('swept OBB TOI: boxes overlap (with slop) at reported contact time', () => {
  fc.assert(
    fc.property(motionBox, motionBox, (a, b) => {
      const toi = sweptOrientedBoxTimeToContact(a, b, 1);
      if (toi === undefined) return true;
      const at = (m: typeof a, t: number) => ({...m, x: m.x + m.velocityX * t, y: m.y + m.velocityY * t});
      return boxesOverlap(at(a, Math.min(1, toi + 1e-4)), at(b, Math.min(1, toi + 1e-4)), 1e-2);
    }),
    FC_RUNS
  );
});

test('manifolds exist iff shapes overlap, with sane normals and depth', () => {
  fc.assert(
    fc.property(posedCircle, posedCircle, (a, b) => {
      const m = circleCircleManifold(a, b);
      if (circlesOverlap(a, b) !== (m !== undefined)) return false;
      if (!m) return true;
      const n = Math.hypot(m.normalX, m.normalY);
      return Math.abs(n - 1) < 1e-9 && m.depth >= 0;
    }),
    FC_RUNS
  );
  fc.assert(
    fc.property(posedBox, posedCircle, (box, circle) => {
      const m = boxCircleManifold(box, circle);
      if (circleBoxOverlap(circle, box) !== (m !== undefined)) return false;
      if (!m) return true;
      const n = Math.hypot(m.normalX, m.normalY);
      return Math.abs(n - 1) < 1e-9 && m.depth >= -1e-9;
    }),
    FC_RUNS
  );
});

test('boxBoxManifold: overlapping boxes produce a manifold that separates them', () => {
  fc.assert(
    fc.property(posedBox, posedBox, (a, b) => {
      const m = boxBoxManifold(a, b);
      if (!boxesOverlap(a, b, -1e-6)) {
        // Clearly separated boxes must not produce a manifold.
        return m === undefined || m.depth < 1e-6;
      }
      if (!m) return false;
      if (m.points.length < 1 || m.points.length > 2) return false;
      const n = Math.hypot(m.normalX, m.normalY);
      if (Math.abs(n - 1) > 1e-9 || m.depth < 0) return false;
      // Pushing B out along the normal by depth (+slop) must separate the boxes.
      const separated = !boxesOverlap(
        a,
        {...b, x: b.x + m.normalX * (m.depth + 0.1), y: b.y + m.normalY * (m.depth + 0.1)},
        -0.05
      );
      return separated;
    }),
    {numRuns: 300, seed: 7}
  );
});

test('boxCircleManifold pushes the circle out of deep overlap (center inside box)', () => {
  const box = {kind: 'box' as const, x: 0, y: 0, angle: 0.3, halfLength: 60, halfWidth: 30};
  const circle = {kind: 'circle' as const, x: 5, y: 3, angle: 0, radius: 10};
  const m = boxCircleManifold(box, circle);
  assert.ok(m);
  const moved = {...circle, x: circle.x + m.normalX * (m.depth + 0.01), y: circle.y + m.normalY * (m.depth + 0.01)};
  assert.equal(circleBoxOverlap(moved, box, -1e-6), false);
  assert.ok(pointInBox(box, circle.x, circle.y));
  assert.ok(closestPointOnBox(box, 200, 200));
});

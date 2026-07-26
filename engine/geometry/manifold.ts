/**
 * Contact manifold generation. Manifolds report a unit normal pointing from
 * shape A toward shape B, a penetration depth (> 0 means overlapping), and
 * 1–2 contact points in deterministic order.
 *
 * Box/box uses SAT axis of least penetration + incident-face clipping
 * (the standard Box2D-style approach, deterministic given input order).
 */

import {emath} from '../core/math';
import {axis, localOffsets, type Axis, type PosedBox, type PosedCircle} from './overlap';

export interface Manifold {
  normalX: number;
  normalY: number;
  depth: number;
  points: ReadonlyArray<{x: number; y: number}>;
}

export function circleCircleManifold(a: PosedCircle, b: PosedCircle): Manifold | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const combined = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq > combined * combined) return undefined;
  const dist = Math.sqrt(distSq);
  const nx = dist > 1e-12 ? dx / dist : 1;
  const ny = dist > 1e-12 ? dy / dist : 0;
  return {
    normalX: nx,
    normalY: ny,
    depth: combined - dist,
    points: [{x: a.x + nx * a.radius, y: a.y + ny * a.radius}],
  };
}

/** Normal points from the box toward the circle. */
export function boxCircleManifold(box: PosedBox, circle: PosedCircle): Manifold | undefined {
  const {forward, side} = localOffsets(box, circle.x, circle.y);
  const clampedF = forward < -box.halfLength ? -box.halfLength : forward > box.halfLength ? box.halfLength : forward;
  const clampedS = side < -box.halfWidth ? -box.halfWidth : side > box.halfWidth ? box.halfWidth : side;
  const f = axis(box.angle);

  const inside = clampedF === forward && clampedS === side;
  if (inside) {
    // Circle center inside the box: push out through the nearest face.
    const faceDistF = box.halfLength - Math.abs(forward);
    const faceDistS = box.halfWidth - Math.abs(side);
    let localNx: number;
    let localNy: number;
    let depth: number;
    if (faceDistF < faceDistS) {
      localNx = forward >= 0 ? 1 : -1;
      localNy = 0;
      depth = faceDistF + circle.radius;
    } else {
      localNx = 0;
      localNy = side >= 0 ? 1 : -1;
      depth = faceDistS + circle.radius;
    }
    const nx = localNx * f.x - localNy * f.y;
    const ny = localNx * f.y + localNy * f.x;
    return {normalX: nx, normalY: ny, depth, points: [{x: circle.x, y: circle.y}]};
  }

  const nearestX = box.x + f.x * clampedF - f.y * clampedS;
  const nearestY = box.y + f.y * clampedF + f.x * clampedS;
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  const distSq = dx * dx + dy * dy;
  if (distSq > circle.radius * circle.radius) return undefined;
  const dist = Math.sqrt(distSq);
  const nx = dist > 1e-12 ? dx / dist : 1;
  const ny = dist > 1e-12 ? dy / dist : 0;
  return {
    normalX: nx,
    normalY: ny,
    depth: circle.radius - dist,
    points: [{x: nearestX, y: nearestY}],
  };
}

interface FaceQuery {
  separation: number;
  faceIndex: number; // 0: +forward, 1: -forward, 2: +side, 3: -side
}

const FACE_NORMALS_LOCAL: ReadonlyArray<Axis> = [
  {x: 1, y: 0},
  {x: -1, y: 0},
  {x: 0, y: 1},
  {x: 0, y: -1},
];

function boxVertices(box: PosedBox): Array<{x: number; y: number}> {
  const f = axis(box.angle);
  const sx = -f.y;
  const sy = f.x;
  const hl = box.halfLength;
  const hw = box.halfWidth;
  return [
    {x: box.x + f.x * hl + sx * hw, y: box.y + f.y * hl + sy * hw},
    {x: box.x + f.x * hl - sx * hw, y: box.y + f.y * hl - sy * hw},
    {x: box.x - f.x * hl - sx * hw, y: box.y - f.y * hl - sy * hw},
    {x: box.x - f.x * hl + sx * hw, y: box.y - f.y * hl + sy * hw},
  ];
}

function faceNormalWorld(box: PosedBox, faceIndex: number): Axis {
  const local = FACE_NORMALS_LOCAL[faceIndex];
  const c = emath.cos(box.angle);
  const s = emath.sin(box.angle);
  return {x: local.x * c - local.y * s, y: local.x * s + local.y * c};
}

/** Max separation of `other`'s vertices behind each face of `reference`. */
function bestFace(reference: PosedBox, other: PosedBox): FaceQuery {
  const otherVerts = boxVertices(other);
  let best: FaceQuery = {separation: -Number.POSITIVE_INFINITY, faceIndex: 0};
  for (let faceIndex = 0; faceIndex < 4; faceIndex++) {
    const n = faceNormalWorld(reference, faceIndex);
    const extent = faceIndex < 2 ? reference.halfLength : reference.halfWidth;
    const faceOffset = n.x * reference.x + n.y * reference.y + extent;
    let minSeparation = Number.POSITIVE_INFINITY;
    for (const v of otherVerts) {
      const separation = n.x * v.x + n.y * v.y - faceOffset;
      if (separation < minSeparation) minSeparation = separation;
    }
    if (minSeparation > best.separation) best = {separation: minSeparation, faceIndex};
  }
  return best;
}

export function boxBoxManifold(a: PosedBox, b: PosedBox): Manifold | undefined {
  const queryA = bestFace(a, b);
  if (queryA.separation > 0) return undefined;
  const queryB = bestFace(b, a);
  if (queryB.separation > 0) return undefined;

  // Reference face = axis of least penetration; small bias prefers A for
  // determinism when nearly equal.
  const useA = queryA.separation >= queryB.separation - 1e-6;
  const reference = useA ? a : b;
  const incident = useA ? b : a;
  const referenceQuery = useA ? queryA : queryB;

  const refNormal = faceNormalWorld(reference, referenceQuery.faceIndex);

  // Incident face: the face of `incident` most anti-parallel to refNormal.
  let incidentFace = 0;
  let minDot = Number.POSITIVE_INFINITY;
  for (let faceIndex = 0; faceIndex < 4; faceIndex++) {
    const n = faceNormalWorld(incident, faceIndex);
    const d = n.x * refNormal.x + n.y * refNormal.y;
    if (d < minDot) {
      minDot = d;
      incidentFace = faceIndex;
    }
  }

  const incidentVerts = boxVertices(incident);
  // Faces (by vertex indices, CCW order matching boxVertices): +forward = [0,1],
  // -forward = [2,3], +side = [3,0], -side = [1,2].
  const faceVertexIndices: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [2, 3],
    [3, 0],
    [1, 2],
  ];
  const [i0, i1] = faceVertexIndices[incidentFace];
  let v0 = incidentVerts[i0];
  let v1 = incidentVerts[i1];

  // Clip the incident edge against the reference face's side planes.
  const refTangent = {x: -refNormal.y, y: refNormal.x};
  const refExtentAlongTangent =
    referenceQuery.faceIndex < 2 ? reference.halfWidth : reference.halfLength;
  const refCenterAlongTangent = refTangent.x * reference.x + refTangent.y * reference.y;

  const clip = (
    p0: {x: number; y: number},
    p1: {x: number; y: number},
    planeNormalX: number,
    planeNormalY: number,
    planeOffset: number
  ): [{x: number; y: number}, {x: number; y: number}] | undefined => {
    const d0 = planeNormalX * p0.x + planeNormalY * p0.y - planeOffset;
    const d1 = planeNormalX * p1.x + planeNormalY * p1.y - planeOffset;
    if (d0 <= 0 && d1 <= 0) return [p0, p1];
    if (d0 > 0 && d1 > 0) return undefined;
    const t = d0 / (d0 - d1);
    const mid = {x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t};
    return d0 > 0 ? [mid, p1] : [p0, mid];
  };

  let edge = clip(v0, v1, refTangent.x, refTangent.y, refCenterAlongTangent + refExtentAlongTangent);
  if (!edge) return undefined;
  edge = clip(edge[0], edge[1], -refTangent.x, -refTangent.y, -(refCenterAlongTangent - refExtentAlongTangent));
  if (!edge) return undefined;

  const refExtent = referenceQuery.faceIndex < 2 ? reference.halfLength : reference.halfWidth;
  const refFaceOffset = refNormal.x * reference.x + refNormal.y * reference.y + refExtent;

  const points: Array<{x: number; y: number}> = [];
  let maxDepth = 0;
  for (const p of edge) {
    const separation = refNormal.x * p.x + refNormal.y * p.y - refFaceOffset;
    if (separation <= 0) {
      points.push({x: p.x, y: p.y});
      if (-separation > maxDepth) maxDepth = -separation;
    }
  }
  if (points.length === 0) return undefined;

  // Manifold normal must point A → B.
  const sign = useA ? 1 : -1;
  return {
    normalX: refNormal.x * sign,
    normalY: refNormal.y * sign,
    depth: maxDepth,
    points,
  };
}

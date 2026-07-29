/**
 * Dynamic contact resolver — the Rapier replacement.
 *
 * Per call: advance bodies by their (kernel-written) velocities over dt in
 * equal substeps, and inside each substep generate contact manifolds
 * (body/body and body/static-tile with interior-face culling), run a fixed
 * number of sequential-impulse iterations (normal + Coulomb friction +
 * angular response), then apply split-impulse positional correction.
 *
 * Everything is deterministic: bodies are processed in id-sorted array order,
 * pairs in (i, j) order, tiles in row-major order.
 */

import type {Contact, EngineBody, WorldState} from '../core/types';
import {STATIC_BODY_ID} from '../core/types';
import {boxBoxManifold, boxCircleManifold, circleCircleManifold, type Manifold} from '../geometry/manifold';
import {shapeAabb, type PosedBox, type PosedShape} from '../geometry/overlap';
import {buildBroadphase, candidatePairs} from '../world/broadphase';
import {isBlockedTile, isInteriorFace, type TileWorld} from '../world/tile-world';
import {posedShape} from '../world/world-state';

export interface ContactTuning {
  /** Restitution restitution combine is averaged; this scales the result. */
  restitutionScale: number;
  /** Velocity below which restitution is ignored (px/s) — kills jitter. */
  restitutionThreshold: number;
  /** Coulomb friction scale on the combined friction coefficient. */
  frictionScale: number;
  /**
   * Friction scale for body-vs-static-tile contacts. The shipped Rapier setup
   * never set friction on static colliders and walls behaved tangentially
   * frictionless — cars scrape along at full speed instead of sticking — so
   * the default preserves that feel.
   */
  staticFrictionScale: number;
  /** Positional correction factor per iteration (0..1). */
  positionalBeta: number;
  /** Penetration allowance before correction kicks in (px). */
  slop: number;
  /** Scales box moment of inertia; lower = spinnier crashes. */
  inertiaScale: number;
  /** Extra multiplier on angular impulse response; pileup-chaos knob. */
  spinResponse: number;
  /** Sequential impulse iterations per substep. */
  iterations: number;
  /** Max substeps per tick (CCD budget). */
  maxSubsteps: number;
}

export const DEFAULT_CONTACT_TUNING: ContactTuning = {
  restitutionScale: 1,
  restitutionThreshold: 30,
  frictionScale: 1,
  staticFrictionScale: 0,
  positionalBeta: 0.2,
  slop: 0.5,
  inertiaScale: 1,
  spinResponse: 1,
  iterations: 8,
  maxSubsteps: 4,
};

export interface ResolveResult {
  contacts: Contact[];
  /** Body ids that hit the static world this tick, with the peak approach speed. */
  staticImpacts: Map<string, number>;
}

interface SolverBody {
  body: EngineBody;
  invMass: number;
  invInertia: number;
}

function momentOfInertia(body: EngineBody, tuning: ContactTuning): number {
  if (body.shape.kind === 'circle') {
    return (body.mass * body.shape.radius * body.shape.radius) / 2;
  }
  const l = body.shape.halfLength * 2;
  const w = body.shape.halfWidth * 2;
  // Physical rectangle inertia m(l²+w²)/12; inertiaScale is the feel knob.
  return (body.mass * (l * l + w * w) * tuning.inertiaScale) / 12;
}

interface ContactConstraint {
  a: number; // index into solver bodies; -1 for static
  b: number;
  normalX: number; // pointing a -> b (for statics: static -> body, a = -1)
  normalY: number;
  pointX: number;
  pointY: number;
  depth: number;
  restitution: number;
  friction: number;
  targetVelocity: number; // restitution bounce velocity
  accumulatedNormal: number;
  accumulatedTangent: number;
  /** Canonical pair ids, firstId < secondId; static id is ''. */
  firstId: string;
  secondId: string;
}

function relativeVelocityAt(
  solver: SolverBody[],
  constraint: ContactConstraint
): {vn: number; vt: number; tangentX: number; tangentY: number} {
  const {normalX, normalY, pointX, pointY} = constraint;
  let vx = 0;
  let vy = 0;
  if (constraint.b >= 0) {
    const sb = solver[constraint.b].body.state;
    vx += sb.linvelX - sb.angvel * (pointY - sb.y);
    vy += sb.linvelY + sb.angvel * (pointX - sb.x);
  }
  if (constraint.a >= 0) {
    const sa = solver[constraint.a].body.state;
    vx -= sa.linvelX - sa.angvel * (pointY - sa.y);
    vy -= sa.linvelY + sa.angvel * (pointX - sa.x);
  }
  const vn = vx * normalX + vy * normalY;
  const tangentX = -normalY;
  const tangentY = normalX;
  const vt = vx * tangentX + vy * tangentY;
  return {vn, vt, tangentX, tangentY};
}

function effectiveMass(
  solver: SolverBody[],
  constraint: ContactConstraint,
  axisX: number,
  axisY: number,
  spinResponse: number
): number {
  let k = 0;
  if (constraint.a >= 0) {
    const sa = solver[constraint.a];
    const rX = constraint.pointX - sa.body.state.x;
    const rY = constraint.pointY - sa.body.state.y;
    const rCrossAxis = rX * axisY - rY * axisX;
    k += sa.invMass + rCrossAxis * rCrossAxis * sa.invInertia * spinResponse;
  }
  if (constraint.b >= 0) {
    const sb = solver[constraint.b];
    const rX = constraint.pointX - sb.body.state.x;
    const rY = constraint.pointY - sb.body.state.y;
    const rCrossAxis = rX * axisY - rY * axisX;
    k += sb.invMass + rCrossAxis * rCrossAxis * sb.invInertia * spinResponse;
  }
  return k > 1e-12 ? 1 / k : 0;
}

function applyImpulse(
  solver: SolverBody[],
  constraint: ContactConstraint,
  impulseX: number,
  impulseY: number,
  spinResponse: number
): void {
  if (constraint.a >= 0) {
    const sa = solver[constraint.a];
    const state = sa.body.state;
    state.linvelX -= impulseX * sa.invMass;
    state.linvelY -= impulseY * sa.invMass;
    const rX = constraint.pointX - state.x;
    const rY = constraint.pointY - state.y;
    state.angvel -= (rX * impulseY - rY * impulseX) * sa.invInertia * spinResponse;
  }
  if (constraint.b >= 0) {
    const sb = solver[constraint.b];
    const state = sb.body.state;
    state.linvelX += impulseX * sb.invMass;
    state.linvelY += impulseY * sb.invMass;
    const rX = constraint.pointX - state.x;
    const rY = constraint.pointY - state.y;
    state.angvel += (rX * impulseY - rY * impulseX) * sb.invInertia * spinResponse;
  }
}

/** Pair-scoped inverse masses honoring one-way dominance. */
function pairInverseMasses(a: EngineBody, b: EngineBody, sa: SolverBody, sb: SolverBody): [number, number, number, number] {
  if (a.dominance > b.dominance) return [0, 0, sb.invMass, sb.invInertia];
  if (b.dominance > a.dominance) return [sa.invMass, sa.invInertia, 0, 0];
  return [sa.invMass, sa.invInertia, sb.invMass, sb.invInertia];
}

function tileBox(tiles: TileWorld, col: number, row: number): PosedBox {
  return {
    kind: 'box',
    x: (col + 0.5) * tiles.tileWidth,
    y: (row + 0.5) * tiles.tileHeight,
    angle: 0,
    halfLength: tiles.tileWidth / 2,
    halfWidth: tiles.tileHeight / 2,
  };
}

function staticManifolds(tiles: TileWorld, shape: PosedShape): Manifold[] {
  const bounds = shapeAabb(shape, 1);
  const startCol = Math.floor(bounds.minX / tiles.tileWidth);
  const endCol = Math.floor(bounds.maxX / tiles.tileWidth);
  const startRow = Math.floor(bounds.minY / tiles.tileHeight);
  const endRow = Math.floor(bounds.maxY / tiles.tileHeight);
  const manifolds: Manifold[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (!isBlockedTile(tiles, col, row)) continue;
      const tile = tileBox(tiles, col, row);
      const manifold =
        shape.kind === 'circle' ? boxCircleManifold(tile, shape) : boxBoxManifold(tile, shape);
      if (!manifold) continue;
      // Interior-face culling: if the manifold pushes the body through a face
      // that is buried against another blocked tile, skip it — prevents
      // catching on seams inside a solid wall run.
      const ax = Math.abs(manifold.normalX);
      const ay = Math.abs(manifold.normalY);
      if (ax > 0.99 || ay > 0.99) {
        const faceNx = ax > 0.99 ? Math.sign(manifold.normalX) : 0;
        const faceNy = ay > 0.99 ? Math.sign(manifold.normalY) : 0;
        if (isInteriorFace(tiles, col, row, faceNx, faceNy)) continue;
      }
      manifolds.push(manifold);
    }
  }
  return manifolds;
}

/**
 * Advance dynamics over `dt` and resolve all contacts. Mutates body states in
 * place (positions, velocities); returns the tick's contact reports.
 */
export function resolveDynamics(
  tiles: TileWorld,
  state: WorldState,
  dt: number,
  tuning: ContactTuning = DEFAULT_CONTACT_TUNING
): ResolveResult {
  const contacts = new Map<string, Contact>();
  const staticImpacts = new Map<string, number>();

  // Substep count from the fastest body: nobody may travel more than half the
  // smaller tile dimension per substep (tunneling guard).
  let maxSpeed = 0;
  for (const body of state.bodies) {
    const speed = Math.sqrt(body.state.linvelX ** 2 + body.state.linvelY ** 2);
    if (speed > maxSpeed) maxSpeed = speed;
  }
  const travelBudget = Math.min(tiles.tileWidth, tiles.tileHeight) / 2;
  const substeps = Math.min(
    tuning.maxSubsteps,
    Math.max(1, Math.ceil((maxSpeed * dt) / travelBudget))
  );
  const h = dt / substeps;

  const solver: SolverBody[] = state.bodies.map((body) => ({
    body,
    invMass: body.mass > 0 ? 1 / body.mass : 0,
    invInertia: (() => {
      const inertia = momentOfInertia(body, tuning);
      return inertia > 0 ? 1 / inertia : 0;
    })(),
  }));

  for (let substep = 0; substep < substeps; substep++) {
    // 1. Integrate positions.
    for (const {body} of solver) {
      body.state.x += body.state.linvelX * h;
      body.state.y += body.state.linvelY * h;
      body.state.angle += body.state.angvel * h;
    }

    // 2. Collect constraints: body-body then body-static, canonical order.
    const broadphase = buildBroadphase(state, undefined, 4);
    const constraints: ContactConstraint[] = [];

    for (const [i, j] of candidatePairs(state, broadphase)) {
      const a = state.bodies[i];
      const b = state.bodies[j];
      const shapeA = posedShape(a);
      const shapeB = posedShape(b);
      let manifold: Manifold | undefined;
      if (shapeA.kind === 'circle' && shapeB.kind === 'circle') {
        manifold = circleCircleManifold(shapeA, shapeB);
      } else if (shapeA.kind === 'box' && shapeB.kind === 'box') {
        manifold = boxBoxManifold(shapeA, shapeB);
      } else if (shapeA.kind === 'box' && shapeB.kind === 'circle') {
        manifold = boxCircleManifold(shapeA, shapeB);
      } else if (shapeA.kind === 'circle' && shapeB.kind === 'box') {
        const flipped = boxCircleManifold(shapeB as PosedBox, shapeA);
        if (flipped) {
          manifold = {...flipped, normalX: -flipped.normalX, normalY: -flipped.normalY};
        }
      }
      if (!manifold) continue;
      const restitution = ((a.restitution + b.restitution) / 2) * tuning.restitutionScale;
      const friction = Math.sqrt(Math.max(0, a.friction) * Math.max(0, b.friction)) * tuning.frictionScale;
      const [firstId, secondId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      for (const point of manifold.points) {
        constraints.push({
          a: i,
          b: j,
          normalX: manifold.normalX,
          normalY: manifold.normalY,
          pointX: point.x,
          pointY: point.y,
          depth: manifold.depth,
          restitution,
          friction,
          targetVelocity: 0,
          accumulatedNormal: 0,
          accumulatedTangent: 0,
          firstId,
          secondId,
        });
      }
    }

    for (let index = 0; index < state.bodies.length; index++) {
      const body = state.bodies[index];
      const shape = posedShape(body);
      for (const manifold of staticManifolds(tiles, shape)) {
        const restitution = body.restitution * tuning.restitutionScale;
        const friction =
          Math.max(0, body.friction) * tuning.frictionScale * tuning.staticFrictionScale;
        for (const point of manifold.points) {
          constraints.push({
            a: -1,
            b: index,
            normalX: manifold.normalX,
            normalY: manifold.normalY,
            pointX: point.x,
            pointY: point.y,
            depth: manifold.depth,
            restitution,
            friction,
            targetVelocity: 0,
            accumulatedNormal: 0,
            accumulatedTangent: 0,
            firstId: STATIC_BODY_ID,
            secondId: body.id,
          });
        }
      }
    }

    if (constraints.length === 0) continue;

    // 3. Restitution targets from pre-solve approach velocities.
    for (const constraint of constraints) {
      const {vn} = relativeVelocityAt(solver, constraint);
      if (vn < -tuning.restitutionThreshold) {
        constraint.targetVelocity = -constraint.restitution * vn;
      }
      if (constraint.a === -1 && vn < -1) {
        const bodyId = solver[constraint.b].body.id;
        const previous = staticImpacts.get(bodyId) ?? 0;
        if (-vn > previous) staticImpacts.set(bodyId, -vn);
      }
    }

    // 4. Sequential impulses with dominance-aware masses.
    const scoped = constraints.map((constraint) => {
      if (constraint.a === -1) {
        const sb = solver[constraint.b];
        return {aInvMass: 0, aInvInertia: 0, bInvMass: sb.invMass, bInvInertia: sb.invInertia};
      }
      const [aInvMass, aInvInertia, bInvMass, bInvInertia] = pairInverseMasses(
        solver[constraint.a].body,
        solver[constraint.b].body,
        solver[constraint.a],
        solver[constraint.b]
      );
      return {aInvMass, aInvInertia, bInvMass, bInvInertia};
    });

    const withScopedMasses = (constraintIndex: number, run: () => void): void => {
      const constraint = constraints[constraintIndex];
      const scope = scoped[constraintIndex];
      const savedA = constraint.a >= 0 ? solver[constraint.a] : undefined;
      const savedB = solver[constraint.b];
      const originalA = savedA ? {invMass: savedA.invMass, invInertia: savedA.invInertia} : undefined;
      const originalB = {invMass: savedB.invMass, invInertia: savedB.invInertia};
      if (savedA) {
        savedA.invMass = scope.aInvMass;
        savedA.invInertia = scope.aInvInertia;
      }
      savedB.invMass = scope.bInvMass;
      savedB.invInertia = scope.bInvInertia;
      run();
      if (savedA && originalA) {
        savedA.invMass = originalA.invMass;
        savedA.invInertia = originalA.invInertia;
      }
      savedB.invMass = originalB.invMass;
      savedB.invInertia = originalB.invInertia;
    };

    for (let iteration = 0; iteration < tuning.iterations; iteration++) {
      for (let constraintIndex = 0; constraintIndex < constraints.length; constraintIndex++) {
        const constraint = constraints[constraintIndex];
        withScopedMasses(constraintIndex, () => {
          // Normal impulse.
          const {vn, vt, tangentX, tangentY} = relativeVelocityAt(solver, constraint);
          const normalMass = effectiveMass(solver, constraint, constraint.normalX, constraint.normalY, tuning.spinResponse);
          let lambda = -(vn - constraint.targetVelocity) * normalMass;
          const newAccumulated = Math.max(0, constraint.accumulatedNormal + lambda);
          lambda = newAccumulated - constraint.accumulatedNormal;
          constraint.accumulatedNormal = newAccumulated;
          applyImpulse(solver, constraint, lambda * constraint.normalX, lambda * constraint.normalY, tuning.spinResponse);

          // Friction impulse, clamped to the Coulomb cone.
          const tangentMass = effectiveMass(solver, constraint, tangentX, tangentY, tuning.spinResponse);
          let tangentLambda = -vt * tangentMass;
          const maxFriction = constraint.friction * constraint.accumulatedNormal;
          const newTangent = Math.max(-maxFriction, Math.min(maxFriction, constraint.accumulatedTangent + tangentLambda));
          tangentLambda = newTangent - constraint.accumulatedTangent;
          constraint.accumulatedTangent = newTangent;
          applyImpulse(solver, constraint, tangentLambda * tangentX, tangentLambda * tangentY, tuning.spinResponse);
        });
      }
    }

    // 5. Split-impulse positional correction (does not pollute velocities).
    {
      for (let constraintIndex = 0; constraintIndex < constraints.length; constraintIndex++) {
        const constraint = constraints[constraintIndex];
        const scope = scoped[constraintIndex];
        const correction = Math.max(0, constraint.depth - tuning.slop) * tuning.positionalBeta;
        if (correction <= 0) continue;
        const totalInvMass = scope.aInvMass + scope.bInvMass;
        if (totalInvMass <= 1e-12) continue;
        const perInvMass = correction / totalInvMass;
        if (constraint.a >= 0 && scope.aInvMass > 0) {
          const sa = solver[constraint.a].body.state;
          sa.x -= constraint.normalX * perInvMass * scope.aInvMass;
          sa.y -= constraint.normalY * perInvMass * scope.aInvMass;
        }
        if (scope.bInvMass > 0) {
          const sb = solver[constraint.b].body.state;
          sb.x += constraint.normalX * perInvMass * scope.bInvMass;
          sb.y += constraint.normalY * perInvMass * scope.bInvMass;
        }
      }
    }

    // 6. Accumulate contact reports: SUM of normal impulses per pair across
    // points and substeps (the tick's total, matching the Contact contract);
    // normal/point/depth come from the deepest constraint seen.
    for (const constraint of constraints) {
      if (constraint.accumulatedNormal <= 0) continue;
      const pairKey = `${constraint.firstId}\u0000${constraint.secondId}`;
      // Normal in the report always points first -> second.
      const aId = constraint.a >= 0 ? solver[constraint.a].body.id : STATIC_BODY_ID;
      const flip = aId !== constraint.firstId;
      const existing = contacts.get(pairKey);
      if (!existing) {
        contacts.set(pairKey, {
          first: constraint.firstId,
          second: constraint.secondId,
          normalX: flip ? -constraint.normalX : constraint.normalX,
          normalY: flip ? -constraint.normalY : constraint.normalY,
          depth: constraint.depth,
          pointX: constraint.pointX,
          pointY: constraint.pointY,
          impulse: constraint.accumulatedNormal,
        });
      } else {
        existing.impulse += constraint.accumulatedNormal;
        if (constraint.depth > existing.depth) {
          existing.depth = constraint.depth;
          existing.normalX = flip ? -constraint.normalX : constraint.normalX;
          existing.normalY = flip ? -constraint.normalY : constraint.normalY;
          existing.pointX = constraint.pointX;
          existing.pointY = constraint.pointY;
        }
      }
    }
  }

  const sortedContacts = [...contacts.values()].sort((a, b) =>
    a.first < b.first ? -1 : a.first > b.first ? 1 : a.second < b.second ? -1 : a.second > b.second ? 1 : 0
  );
  return {contacts: sortedContacts, staticImpacts};
}

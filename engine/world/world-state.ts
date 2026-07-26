/** WorldState construction and canonical ordering helpers. */

import {finite} from '../core/math';
import type {BodyState, EngineBody, Shape, WorldState} from '../core/types';

export function createWorldState(tick = 0, staticRevision = 0): WorldState {
  return {tick, staticRevision, bodies: []};
}

export function sortBodies(bodies: EngineBody[]): void {
  bodies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function findBody(state: WorldState, id: string): EngineBody | undefined {
  // Binary search over the id-sorted array.
  let low = 0;
  let high = state.bodies.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = state.bodies[mid];
    if (candidate.id === id) return candidate;
    if (candidate.id < id) low = mid + 1;
    else high = mid - 1;
  }
  return undefined;
}

export function upsertBody(state: WorldState, body: EngineBody): void {
  const existing = findBody(state, body.id);
  if (existing) {
    const index = state.bodies.indexOf(existing);
    state.bodies[index] = body;
    return;
  }
  state.bodies.push(body);
  sortBodies(state.bodies);
}

export function removeBody(state: WorldState, id: string): boolean {
  const body = findBody(state, id);
  if (!body) return false;
  state.bodies.splice(state.bodies.indexOf(body), 1);
  return true;
}

export function sanitizeBodyState(state: BodyState): BodyState {
  return {
    x: finite(state.x),
    y: finite(state.y),
    angle: finite(state.angle),
    linvelX: finite(state.linvelX),
    linvelY: finite(state.linvelY),
    angvel: finite(state.angvel),
  };
}

export function posedShape(body: EngineBody): (Shape & {x: number; y: number; angle: number}) {
  return {...body.shape, x: body.state.x, y: body.state.y, angle: body.state.angle};
}

/** Deep-copy a body (plain data only). */
export function cloneBody(body: EngineBody): EngineBody {
  return {...body, shape: {...body.shape}, state: {...body.state}};
}

export function cloneWorldState(state: WorldState): WorldState {
  return {
    tick: state.tick,
    staticRevision: state.staticRevision,
    bodies: state.bodies.map(cloneBody),
  };
}

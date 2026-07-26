/**
 * Snapshot, restore, serialize, and hash world state. The hash scheme is the
 * same FNV-1a + fmix32 used by server/game/journal/state-hash.ts so engine
 * hashes can sit alongside journal hashes.
 */

import type {EngineBody, WorldState} from '../core/types';
import {cloneWorldState} from './world-state';

export class EngineHashStream {
  private hash = 0x811c9dc5;
  private readonly scratch = new DataView(new ArrayBuffer(8));

  string(value: string): void {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      this.byte(code & 0xff);
      this.byte((code >>> 8) & 0xff);
    }
    this.byte(0xff);
  }

  number(value: number): void {
    // Normalize -0 to +0: JSON round-trips -0 as 0, so hashing must not
    // distinguish them or serialize→restore breaks hash identity.
    this.scratch.setFloat64(0, value === 0 ? 0 : value, true);
    for (let index = 0; index < 8; index++) this.byte(this.scratch.getUint8(index));
  }

  value(): number {
    let mixed = this.hash;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x7feb352d);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x846ca68b);
    mixed ^= mixed >>> 16;
    return mixed >>> 0;
  }

  private byte(value: number): void {
    this.hash ^= value;
    this.hash = Math.imul(this.hash, 0x01000193);
  }
}

function writeBody(stream: EngineHashStream, body: EngineBody): void {
  stream.string(body.id);
  stream.number(body.layer);
  stream.number(body.mask);
  stream.string(body.shape.kind);
  if (body.shape.kind === 'circle') {
    stream.number(body.shape.radius);
  } else {
    stream.number(body.shape.halfLength);
    stream.number(body.shape.halfWidth);
  }
  stream.number(body.mass);
  stream.number(body.restitution);
  stream.number(body.friction);
  stream.number(body.dominance);
  stream.number(body.state.x);
  stream.number(body.state.y);
  stream.number(body.state.angle);
  stream.number(body.state.linvelX);
  stream.number(body.state.linvelY);
  stream.number(body.state.angvel);
}

export function writeWorldState(stream: EngineHashStream, state: WorldState): void {
  stream.number(state.tick);
  stream.number(state.staticRevision);
  stream.number(state.bodies.length);
  for (const body of state.bodies) writeBody(stream, body);
}

export function hashWorldState(state: WorldState): number {
  const stream = new EngineHashStream();
  writeWorldState(stream, state);
  return stream.value();
}

/** Immutable deep copy for the history ring / prediction base states. */
export function snapshotWorldState(state: WorldState): WorldState {
  return cloneWorldState(state);
}

export function serializeWorldState(state: WorldState): string {
  return JSON.stringify(state);
}

export function deserializeWorldState(payload: string): WorldState {
  const state = JSON.parse(payload) as WorldState;
  // Re-establish invariants: canonical id order and finite numerics.
  state.bodies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const body of state.bodies) {
    for (const key of ['x', 'y', 'angle', 'linvelX', 'linvelY', 'angvel'] as const) {
      if (!Number.isFinite(body.state[key])) body.state[key] = 0;
    }
  }
  return state;
}

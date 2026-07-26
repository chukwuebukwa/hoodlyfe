/**
 * Engine data model. Everything is plain, enumerable data — no classes with
 * behavior, no Maps/Sets — so that world state can be snapshotted, hashed,
 * serialized into the journal, and restored byte-for-byte.
 */

export interface ShapeCircle {
  readonly kind: 'circle';
  readonly radius: number;
}

/** Oriented box; halfLength is along the body's heading (+x at angle 0). */
export interface ShapeBox {
  readonly kind: 'box';
  readonly halfLength: number;
  readonly halfWidth: number;
}

export type Shape = ShapeCircle | ShapeBox;

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

export interface Velocity {
  linvelX: number;
  linvelY: number;
  angvel: number;
}

/** Mirrors PhysicsBodyState in shared/physics/physics-world.ts for 1:1 porting. */
export interface BodyState extends Pose, Velocity {}

export const LAYER_STATIC = 1;
export const LAYER_VEHICLE = 2;
export const LAYER_HUMANOID = 4;
export const LAYER_PROP = 8;

export interface EngineBody {
  /** Stable string key; same keys the game uses today ("vehicle:...", etc.). */
  id: string;
  /** Collision-layer membership bitmask. */
  layer: number;
  /** Layers this body collides with. */
  mask: number;
  shape: Shape;
  mass: number;
  restitution: number;
  friction: number;
  /**
   * One-way pushing: a body only yields to bodies of equal or higher dominance.
   * Vehicles = 1, humanoids = 0 — vehicles push pedestrians, never the reverse.
   */
  dominance: number;
  state: BodyState;
}

export interface Contact {
  /** Body ids with first < second (string compare) — canonical pair order. */
  first: string;
  second: string;
  /** Unit normal pointing from `first` toward `second`. */
  normalX: number;
  normalY: number;
  depth: number;
  pointX: number;
  pointY: number;
  /** Accumulated scalar normal impulse applied this tick. */
  impulse: number;
}

/** Id of the static tile world in Contact records (always sorts first). */
export const STATIC_BODY_ID = '';

export interface WorldState {
  tick: number;
  staticRevision: number;
  /** ALWAYS sorted by id — the canonical iteration and hashing order. */
  bodies: EngineBody[];
}

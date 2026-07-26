/**
 * The canonical per-tick dynamics sequence (replaces PhysicsWorld.step()):
 *   1. kernels write desired VELOCITIES ONLY into body states (use
 *      driveVehicleState — never copy a kernel's integrated pose into a body,
 *      the resolver is the sole pose integrator and doing both
 *      double-integrates);
 *   2. resolveDynamics advances positions and resolves contacts;
 *   3. caller reads back states + contacts.
 */

import type {WorldState} from '../core/types';
import type {TileWorld} from '../world/tile-world';
import {resolveDynamics, DEFAULT_CONTACT_TUNING, type ContactTuning, type ResolveResult} from './vehicle-contact';
import {normalizeAngle} from '../core/math';

export const ENGINE_STEP_SECONDS = 1 / 60;

export function stepDynamics(
  tiles: TileWorld,
  state: WorldState,
  dt: number = ENGINE_STEP_SECONDS,
  tuning: ContactTuning = DEFAULT_CONTACT_TUNING
): ResolveResult {
  const result = resolveDynamics(tiles, state, dt, tuning);
  for (const body of state.bodies) {
    body.state.angle = normalizeAngle(body.state.angle);
  }
  state.tick += 1;
  return result;
}

/**
 * Impact-event adapter: maps resolver output onto the exact consumer contract
 * PhysicsWorld exposes today (contacts() + hasStaticImpact()), so damage-from-
 * impact, crash audio, and vehicle-body-drive port without logic changes —
 * and WORLD_CONTACT_SHORTFALL inference dies, because the resolver reports
 * static contacts directly.
 */

import type {Contact} from '../core/types';
import {STATIC_BODY_ID} from '../core/types';
import type {ResolveResult} from '../solvers/vehicle-contact';

/** Same shape as PhysicsContact in shared/physics/physics-world.ts. */
export interface ImpactContact {
  first: string;
  second: string;
  normalX: number;
  normalY: number;
  impulse: number;
}

/** Body-vs-body contacts only, sorted by (first, second) — statics excluded. */
export function bodyContacts(result: ResolveResult): ImpactContact[] {
  return result.contacts
    .filter((contact) => contact.first !== STATIC_BODY_ID)
    .map(({first, second, normalX, normalY, impulse}) => ({first, second, normalX, normalY, impulse}));
}

/**
 * Same semantics PhysicsWorld.hasStaticImpact provides: did this body hit the
 * static world this tick with meaningful approach speed (> 1 unit/s)?
 */
export function hasStaticImpact(result: ResolveResult, key: string): boolean {
  return (result.staticImpacts.get(key) ?? 0) > 1;
}

/** Peak approach speed into the static world this tick (0 when no impact). */
export function staticImpactSpeed(result: ResolveResult, key: string): number {
  return result.staticImpacts.get(key) ?? 0;
}

export function contactsBetween(result: ResolveResult, keyA: string, keyB: string): Contact | undefined {
  const [first, second] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  return result.contacts.find((contact) => contact.first === first && contact.second === second);
}

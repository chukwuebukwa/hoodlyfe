export type CrimeKind =
  | 'vehicle-theft'
  | 'assault'
  | 'assault-police'
  | 'hit-and-run'
  | 'hit-and-run-police'
  | 'murder'
  | 'murder-police';

export interface CrimePolicy {
  severity: number;
  lifetimeMs: number;
  dedupeMs: number;
}

export const CRIME_POLICIES: Readonly<Record<CrimeKind, CrimePolicy>> = {
  'vehicle-theft': {severity: 20, lifetimeMs: 12_000, dedupeMs: 1400},
  assault: {severity: 12, lifetimeMs: 9000, dedupeMs: 850},
  'assault-police': {severity: 35, lifetimeMs: 14_000, dedupeMs: 850},
  'hit-and-run': {severity: 24, lifetimeMs: 10_000, dedupeMs: 1000},
  'hit-and-run-police': {severity: 45, lifetimeMs: 15_000, dedupeMs: 1000},
  murder: {severity: 40, lifetimeMs: 18_000, dedupeMs: 1800},
  'murder-police': {severity: 60, lifetimeMs: 24_000, dedupeMs: 1800}
};

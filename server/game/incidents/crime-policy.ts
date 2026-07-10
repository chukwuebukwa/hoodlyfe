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
  'vehicle-theft': {severity: 12, lifetimeMs: 12_000, dedupeMs: 1400},
  assault: {severity: 10, lifetimeMs: 9000, dedupeMs: 850},
  'assault-police': {severity: 28, lifetimeMs: 14_000, dedupeMs: 850},
  'hit-and-run': {severity: 16, lifetimeMs: 10_000, dedupeMs: 1000},
  'hit-and-run-police': {severity: 34, lifetimeMs: 15_000, dedupeMs: 1000},
  murder: {severity: 32, lifetimeMs: 18_000, dedupeMs: 1800},
  'murder-police': {severity: 52, lifetimeMs: 24_000, dedupeMs: 1800}
};

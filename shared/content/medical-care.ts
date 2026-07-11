export const MEDICAL_CARE_KINDS = ['public', 'trauma'] as const;
export type MedicalCareKind = typeof MEDICAL_CARE_KINDS[number];

export interface MedicalCareDefinition {
  readonly id: MedicalCareKind;
  readonly label: string;
  readonly delayMs: number;
  readonly cost: number;
  readonly restoreAmmo: boolean;
}

const MEDICAL_CARE: Readonly<Record<MedicalCareKind, MedicalCareDefinition>> = Object.freeze({
  public: Object.freeze({
    id: 'public',
    label: 'Public Ward',
    delayMs: 4200,
    cost: 0,
    restoreAmmo: false
  }),
  trauma: Object.freeze({
    id: 'trauma',
    label: 'Trauma Care',
    delayMs: 2200,
    cost: 250,
    restoreAmmo: true
  })
});

export function medicalCareDefinition(kind: string): MedicalCareDefinition {
  return isMedicalCareKind(kind) ? MEDICAL_CARE[kind] : MEDICAL_CARE.public;
}

export function isMedicalCareKind(kind: unknown): kind is MedicalCareKind {
  return typeof kind === 'string' && (MEDICAL_CARE_KINDS as readonly string[]).includes(kind);
}

import type {MedicalCareKind} from '../content/medical-care.ts';

export const MEDICAL_CARE_MESSAGE = 'medical.care';

export interface MedicalCareMessage {
  kind?: MedicalCareKind;
}

import {medicalCareDefinition, type MedicalCareKind} from '../../../shared/content/medical-care.ts';
import type {NetworkPlayer} from '../types.ts';

export interface MedicalCareProjection {
  care: MedicalCareKind;
  label: string;
  publicDisabled: boolean;
  traumaDisabled: boolean;
}

export function projectMedicalCare(player?: NetworkPlayer): MedicalCareProjection {
  const care = medicalCareDefinition(player?.respawnCare ?? 'public');
  const dead = Boolean(player && !player.alive);
  const trauma = medicalCareDefinition('trauma');
  return {
    care: care.id,
    label: care.label,
    publicDisabled: !dead || care.id !== 'public',
    traumaDisabled: !dead || care.id === 'trauma' || (player?.cash ?? 0) < trauma.cost
  };
}

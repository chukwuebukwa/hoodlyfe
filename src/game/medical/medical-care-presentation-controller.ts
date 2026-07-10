import type {Room} from 'colyseus.js';
import type {MedicalCareKind} from '../../../shared/content/medical-care.ts';
import {MEDICAL_CARE_MESSAGE} from '../../../shared/protocol/medical-care.ts';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';
import {projectMedicalCare} from './medical-care-presentation-policy.ts';

export class MedicalCarePresentationController {
  private readonly status: Element | null;
  private readonly publicButton: HTMLButtonElement | null;
  private readonly traumaButton: HTMLButtonElement | null;
  private player?: NetworkPlayer;

  constructor(
    private readonly room: Room<DistrictNetworkState>,
    private readonly root: Document = document
  ) {
    this.status = root.querySelector('#medical-care-status');
    this.publicButton = root.querySelector<HTMLButtonElement>('#medical-public');
    this.traumaButton = root.querySelector<HTMLButtonElement>('#medical-trauma');
    this.publicButton?.addEventListener('click', this.selectPublic);
    this.traumaButton?.addEventListener('click', this.selectTrauma);
  }

  synchronize(player?: NetworkPlayer): void {
    this.player = player;
    const projection = projectMedicalCare(player);
    if (this.status) this.status.textContent = projection.label;
    if (this.publicButton) {
      this.publicButton.disabled = projection.publicDisabled;
      this.publicButton.setAttribute('aria-pressed', String(projection.care === 'public'));
    }
    if (this.traumaButton) {
      this.traumaButton.disabled = projection.traumaDisabled;
      this.traumaButton.setAttribute('aria-pressed', String(projection.care === 'trauma'));
    }
  }

  destroy(): void {
    this.publicButton?.removeEventListener('click', this.selectPublic);
    this.traumaButton?.removeEventListener('click', this.selectTrauma);
    this.player = undefined;
  }

  private select(kind: MedicalCareKind): void {
    if (!this.player || this.player.alive) return;
    this.room.send(MEDICAL_CARE_MESSAGE, {kind});
  }

  private readonly selectPublic = (event: Event): void => {
    event.stopPropagation();
    this.select('public');
  };

  private readonly selectTrauma = (event: Event): void => {
    event.stopPropagation();
    this.select('trauma');
  };
}

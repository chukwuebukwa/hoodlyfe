import type {Room} from 'colyseus.js';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {
  QA_TELEPORT_DESTINATIONS,
  QA_TELEPORT_MESSAGE,
  type QaTeleportDestinationId
} from '../../../shared/protocol/qa-teleport.ts';
import type {DistrictNetworkState} from '../types.ts';

export class QaDriver {
  private readonly panel = document.createElement('aside');

  constructor(private readonly room: Room<DistrictNetworkState>) {
    this.panel.id = 'qa-controls';
    this.panel.innerHTML = [
      '<strong>QA TELEPORT</strong>',
      '<select aria-label="QA teleport destination" data-testid="qa-teleport-destination">',
      ...QA_TELEPORT_DESTINATIONS.map(({id, label}) => `<option value="${id}">${label}</option>`),
      '</select>',
      '<button type="button" data-testid="qa-teleport">GO</button>',
      '<span data-testid="qa-space">street</span>'
    ].join('');
    document.querySelector('#game-shell')?.append(this.panel);
    this.panel.querySelector('[data-testid="qa-teleport"]')
      ?.addEventListener('click', this.teleport);
  }

  update(): void {
    const player = this.room.state.players.get(this.room.sessionId);
    const label = this.panel.querySelector('[data-testid="qa-space"]');
    if (label) {
      const spaceId = player?.spaceId || STREET_SPACE_ID;
      label.textContent = player
        ? `${spaceId} · ${Math.round(player.x)}, ${Math.round(player.y)}`
        : spaceId;
    }
  }

  destroy(): void {
    this.panel.querySelector('[data-testid="qa-teleport"]')
      ?.removeEventListener('click', this.teleport);
    this.panel.remove();
  }

  private readonly teleport = (): void => {
    const select = this.panel.querySelector<HTMLSelectElement>(
      '[data-testid="qa-teleport-destination"]'
    );
    if (!select) return;
    this.room.send(QA_TELEPORT_MESSAGE, {
      destinationId: select.value as QaTeleportDestinationId
    });
  };
}

import type {Room} from 'colyseus.js';
import {INTERIORS, STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import type {DistrictNetworkState} from '../types.ts';

const STEP_INTERVAL_MS = 50;
const MAX_DRIVE_MS = 8000;

export class ThreeQaDriver {
  private readonly panel = document.createElement('aside');
  private timer?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;

  constructor(private readonly room: Room<DistrictNetworkState>) {
    this.panel.id = 'three-qa-controls';
    this.panel.innerHTML = [
      '<strong>QA DRIVER</strong>',
      '<button type="button" data-testid="qa-enter-interior">ENTER HOSPITAL</button>',
      '<button type="button" data-testid="qa-exit-interior">EXIT HOSPITAL</button>',
      '<span data-testid="qa-space">street</span>'
    ].join('');
    document.querySelector('#game-shell')?.append(this.panel);
    this.panel.querySelector('[data-testid="qa-enter-interior"]')
      ?.addEventListener('click', this.enter);
    this.panel.querySelector('[data-testid="qa-exit-interior"]')
      ?.addEventListener('click', this.exit);
  }

  update(): void {
    const player = this.room.state.players.get(this.room.sessionId);
    const label = this.panel.querySelector('[data-testid="qa-space"]');
    if (label) label.textContent = player?.spaceId || STREET_SPACE_ID;
  }

  destroy(): void {
    this.stop();
    this.panel.querySelector('[data-testid="qa-enter-interior"]')
      ?.removeEventListener('click', this.enter);
    this.panel.querySelector('[data-testid="qa-exit-interior"]')
      ?.removeEventListener('click', this.exit);
    this.panel.remove();
  }

  private readonly enter = (): void => {
    const interior = INTERIORS[0];
    this.drive(
      interior.exteriorDoor.x,
      interior.exteriorDoor.y,
      () => this.room.state.players.get(this.room.sessionId)?.spaceId === interior.id
    );
  };

  private readonly exit = (): void => {
    const interior = INTERIORS[0];
    this.drive(
      interior.exitDoor.maxX,
      (interior.exitDoor.minY + interior.exitDoor.maxY) / 2,
      () => (this.room.state.players.get(this.room.sessionId)?.spaceId || STREET_SPACE_ID) === STREET_SPACE_ID
    );
  };

  private drive(x: number, y: number, complete: () => boolean): void {
    this.stop();
    const step = () => {
      if (complete()) {
        this.stop();
        return;
      }
      const player = this.room.state.players.get(this.room.sessionId);
      if (!player?.alive || player.vehicleId) {
        this.stop();
        return;
      }
      const deltaX = x - player.x;
      const deltaY = y - player.y;
      const magnitude = Math.max(1, Math.hypot(deltaX, deltaY));
      this.room.send('input', {x: deltaX / magnitude, y: deltaY / magnitude});
    };
    step();
    this.timer = setInterval(step, STEP_INTERVAL_MS);
    this.timeout = setTimeout(this.stop, MAX_DRIVE_MS);
  }

  private readonly stop = (): void => {
    if (this.timer) clearInterval(this.timer);
    if (this.timeout) clearTimeout(this.timeout);
    this.timer = undefined;
    this.timeout = undefined;
    this.room.send('input', {x: 0, y: 0});
  };
}

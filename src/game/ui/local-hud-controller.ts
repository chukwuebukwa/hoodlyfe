import type {GameNotice} from '../../../shared/protocol/notices.ts';
import type {NetworkPlayer, NetworkVehicle} from '../types.ts';
import {
  hudTransitionNotices,
  hudTransitionState,
  projectLocalHud,
  type HudNotice,
  type HudTransitionState
} from './hud-policy.ts';

const MAX_QUEUED_NOTICES = 6;
const NOTICE_DURATION_MS = 1300;

export class LocalHudController {
  private readonly name: Element | null;
  private readonly cash: Element | null;
  private readonly healthFill: HTMLElement | null;
  private readonly healthTrack: Element | null;
  private readonly armorFill: HTMLElement | null;
  private readonly armorTrack: Element | null;
  private readonly heatMeter: Element | null;
  private readonly heatCells: Element[];
  private readonly deathScreen: Element | null;
  private readonly vehicleHud: Element | null;
  private readonly weaponHud: Element | null;
  private readonly weaponName: Element | null;
  private readonly weaponAmmo: Element | null;
  private readonly weaponIcon: HTMLImageElement | null;
  private readonly speedValue: Element | null;
  private readonly vehicleCondition: HTMLElement | null;
  private readonly vehicleConditionTrack: Element | null;
  private readonly shell: HTMLElement | null;
  private readonly toast: Element | null;
  private readonly connection: Element | null;
  private readonly noticeQueue: HudNotice[] = [];
  private previous?: HudTransitionState;
  private activeNotice?: HudNotice;
  private noticeTimeout?: ReturnType<typeof setTimeout>;

  constructor(root: Document = document) {
    this.name = root.querySelector('#driver-name');
    this.cash = root.querySelector('#cash');
    this.healthFill = root.querySelector<HTMLElement>('#health-fill');
    this.healthTrack = root.querySelector('#health-track');
    this.armorFill = root.querySelector<HTMLElement>('#armor-fill');
    this.armorTrack = root.querySelector('#armor-track');
    this.heatMeter = root.querySelector('#heat-meter');
    this.heatCells = [...root.querySelectorAll('#heat-meter i')];
    this.deathScreen = root.querySelector('#death-screen');
    this.vehicleHud = root.querySelector('#vehicle-hud');
    this.weaponHud = root.querySelector('#weapon-hud');
    this.weaponName = root.querySelector('#weapon-name');
    this.weaponAmmo = root.querySelector('#weapon-ammo');
    this.weaponIcon = root.querySelector<HTMLImageElement>('#weapon-icon');
    this.speedValue = root.querySelector('#speed-value');
    this.vehicleCondition = root.querySelector<HTMLElement>('#vehicle-condition-fill');
    this.vehicleConditionTrack = root.querySelector('#vehicle-condition');
    this.shell = root.querySelector<HTMLElement>('#game-shell');
    this.toast = root.querySelector('#event-toast');
    this.connection = root.querySelector('#connection-state');
  }

  update(player: NetworkPlayer, vehicle?: NetworkVehicle): void {
    const projection = projectLocalHud(player, vehicle);
    if (this.name) this.name.textContent = projection.name;
    if (this.cash) this.cash.textContent = projection.cash;
    if (this.healthFill) this.healthFill.style.width = `${projection.health}%`;
    this.healthTrack?.setAttribute('aria-label', `Health ${player.health}`);
    if (this.armorFill) this.armorFill.style.width = `${projection.armor}%`;
    this.armorTrack?.classList.toggle('hidden', !projection.showArmor);
    this.armorTrack?.setAttribute('aria-label', `Armor ${projection.armor}`);
    this.heatMeter?.setAttribute('aria-label', `Heat level ${projection.wanted}`);
    this.heatCells.forEach((cell, index) => cell.classList.toggle('active', index < projection.wanted));
    this.deathScreen?.classList.toggle('hidden', !projection.dead);
    this.vehicleHud?.classList.toggle('hidden', !projection.showVehicleHud);
    this.weaponHud?.classList.toggle('hidden', !projection.showWeaponHud);
    if (this.weaponName) this.weaponName.textContent = projection.weaponName;
    if (this.weaponAmmo) {
      this.weaponAmmo.textContent = projection.weaponAmmo === undefined
        ? ''
        : projection.weaponAmmo;
      this.weaponAmmo.classList.toggle('hidden', projection.weaponAmmo === undefined);
      this.weaponAmmo.classList.toggle('reloading', projection.reloading);
    }
    if (this.weaponIcon) {
      this.weaponIcon.src = projection.weaponIcon;
      this.weaponIcon.alt = player.weapon;
    }
    if (this.speedValue) this.speedValue.textContent = projection.speed;
    if (this.vehicleCondition) {
      this.vehicleCondition.style.width = `${projection.vehicleCondition}%`;
    }
    this.vehicleConditionTrack?.setAttribute(
      'aria-label',
      `Vehicle condition ${projection.vehicleHealth}`
    );
    if (this.shell) {
      this.shell.dataset.mode = projection.mode;
      this.shell.dataset.health = String(player.health);
      this.shell.dataset.armor = String(projection.armor);
      this.shell.dataset.wanted = String(projection.wanted);
      this.shell.dataset.action = projection.action;
      this.shell.dataset.reloading = String(projection.reloading);
    }
    const current = hudTransitionState(player);
    for (const notice of hudTransitionNotices(this.previous, current)) this.showNotice(notice);
    this.previous = current;
  }

  show(message: string, tone: GameNotice['tone'] = 'info'): void {
    this.showNotice({message, tone});
  }

  setConnection(online: boolean): void {
    if (!this.connection) return;
    this.connection.textContent = online ? 'Online' : 'Disconnected';
    this.connection.classList.toggle('offline', !online);
  }

  destroy(): void {
    if (this.noticeTimeout) clearTimeout(this.noticeTimeout);
    this.noticeTimeout = undefined;
    this.noticeQueue.length = 0;
    this.activeNotice = undefined;
    if (this.toast) {
      this.toast.classList.remove('visible');
      this.toast.removeAttribute('data-tone');
      this.toast.textContent = '';
    }
  }

  private showNotice(notice: HudNotice): void {
    const duplicate = this.activeNotice?.message === notice.message ||
      this.noticeQueue.at(-1)?.message === notice.message;
    if (duplicate) return;
    if (this.noticeQueue.length >= MAX_QUEUED_NOTICES) this.noticeQueue.shift();
    this.noticeQueue.push(notice);
    this.playNextNotice();
  }

  private playNextNotice(): void {
    if (this.activeNotice || !this.toast) return;
    const notice = this.noticeQueue.shift();
    if (!notice) return;
    this.activeNotice = notice;
    this.toast.textContent = notice.message;
    this.toast.setAttribute('data-tone', notice.tone);
    this.toast.classList.add('visible');
    this.noticeTimeout = setTimeout(() => {
      this.toast?.classList.remove('visible');
      this.activeNotice = undefined;
      this.noticeTimeout = undefined;
      this.playNextNotice();
    }, NOTICE_DURATION_MS);
  }
}

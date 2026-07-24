import {
  LPC_HAT_OPTIONS,
  LPC_HAIR_OPTIONS,
  LPC_LEGS_OPTIONS,
  LPC_SHOE_OPTIONS,
  LPC_TOP_OPTIONS,
  parseLpcRecipe,
  type LpcOption
} from '../../../shared/content/lpc-character-catalog.ts';
import {loadSavedAppearance} from '../appearance/appearance-storage.ts';
import type {GameWorldId} from '../runtime/world-catalog.ts';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';
import {projectPhoneActivity} from './phone-activity-policy.ts';
import {phoneGlyph, type PhoneGlyphName} from './phone-glyphs.ts';

const DRIVER_NAME_KEY = 'nock0-driver-name';
const LPC_STORAGE_KEY = 'nock0-lpc-recipe';
const WALLET_ADDRESS_KEYS = [
  'nock0-wallet-address',
  'nock0-privy-wallet-address',
  'privy-wallet-address'
];

export interface PhoneActivityContext {
  busy: boolean;
  currentWorld: GameWorldId;
  onTravel: (destination: GameWorldId) => Promise<void> | void;
}

export class NockPhoneController {
  private static shared?: NockPhoneController;
  private readonly button: HTMLButtonElement | null;
  private popup?: HTMLElement;
  private renderedMarkup?: string;
  private activeApp: 'home' | 'profile' | 'wallet' | 'jobs' = 'home';
  private localPlayer?: NetworkPlayer;
  private activityContext?: PhoneActivityContext;

  static forDocument(root: Document = document): NockPhoneController {
    if (!NockPhoneController.shared) {
      NockPhoneController.shared = new NockPhoneController(root);
    }
    return NockPhoneController.shared;
  }

  constructor(private readonly root: Document = document) {
    this.button = root.querySelector<HTMLButtonElement>('#phone-button');
    this.button?.addEventListener('click', this.handleButtonClick);
    root.addEventListener('keydown', this.handleKeyDown);
    this.setAvailable(false);
  }

  isOpen(): boolean {
    return Boolean(this.popup && !this.popup.classList.contains('hidden'));
  }

  setAvailable(available: boolean): void {
    if (!this.button) return;
    this.button.classList.toggle('hidden', !available);
    this.button.setAttribute('aria-hidden', String(!available));
    this.button.tabIndex = available ? 0 : -1;
    if (!available) this.close();
  }

  synchronize(state: DistrictNetworkState, localPlayerId: string): void {
    this.localPlayer = state.players.get(localPlayerId);
    if (this.isOpen()) this.render();
  }

  setActivityContext(context: PhoneActivityContext | undefined): void {
    this.activityContext = context;
    if (!context && this.activeApp === 'jobs') this.activeApp = 'home';
    if (this.isOpen()) this.render();
  }

  destroy(): void {
    this.button?.removeEventListener('click', this.handleButtonClick);
    this.root.removeEventListener('keydown', this.handleKeyDown);
    this.popup?.remove();
    this.popup = undefined;
    this.renderedMarkup = undefined;
    this.button?.setAttribute('aria-expanded', 'false');
    this.setAvailable(false);
    if (NockPhoneController.shared === this) NockPhoneController.shared = undefined;
  }

  private readonly handleButtonClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.isOpen()) {
      this.close();
    } else {
      this.open('home');
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      this.close();
    }
  };

  private open(app: 'home' | 'profile' | 'wallet' | 'jobs'): void {
    this.activeApp = app;
    this.ensurePopup();
    this.popup?.classList.remove('hidden');
    this.button?.setAttribute('aria-expanded', 'true');
    this.render();
  }

  private close(): void {
    this.popup?.classList.add('hidden');
    this.button?.setAttribute('aria-expanded', 'false');
    this.activeApp = 'home';
  }

  private ensurePopup(): HTMLElement {
    if (this.popup?.isConnected) return this.popup;
    const popup = this.root.createElement('aside');
    popup.id = 'profile-popup';
    popup.className = 'hud-layer hidden';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-label', 'Game phone');
    this.root.body.append(popup);
    this.popup = popup;
    this.renderedMarkup = undefined;
    return popup;
  }

  private render(): void {
    const popup = this.ensurePopup();
    const clock = currentClock();
    const markup = `
      <header id="phone-status-bar">
        <time datetime="${clock}">${clock}</time>
        <span id="phone-dynamic-island" aria-hidden="true"><i></i></span>
        <span id="phone-status-icons" aria-hidden="true">
          <i class="phone-cellular"><b></b><b></b><b></b><b></b></i>
          ${phoneGlyph('wifi')}
          <i class="phone-battery"><b></b></i>
        </span>
      </header>
      <button id="profile-close" type="button" aria-label="Close phone">${phoneGlyph('close')}</button>
      <main id="phone-screen">
        ${this.renderHome()}
        ${this.renderProfile()}
        ${this.renderWallet()}
        ${this.renderJobs()}
      </main>
      <footer id="phone-home-indicator" aria-hidden="true"><i></i></footer>
    `;
    popup.dataset.app = this.activeApp;
    if (markup === this.renderedMarkup) return;
    popup.innerHTML = markup;
    this.renderedMarkup = markup;
    const closeButton = popup.querySelector('#profile-close');
    closeButton?.addEventListener('pointerdown', this.handleClosePointerDown);
    closeButton?.addEventListener('click', this.handleCloseClick);
    popup.querySelectorAll<HTMLButtonElement>('[data-app]').forEach((button) => {
      button.addEventListener('click', this.handleAppClick);
    });
    popup.querySelector('#wallet-copy-address')?.addEventListener('click', this.handleCopyWalletAddress);
    popup.querySelector('#wallet-refresh')?.addEventListener('click', this.handleRefreshClick);
    popup.querySelector('#profile-refresh')?.addEventListener('click', this.handleRefreshClick);
    popup.querySelector('#phone-activity-action')?.addEventListener(
      'click',
      this.handleActivityClick
    );
  }

  private renderHome(): string {
    const hidden = this.activeApp === 'home' ? '' : ' hidden';
    const locationLabel = this.activityContext
      ? projectPhoneActivity(this.activityContext.currentWorld).locationLabel
      : 'Industrial District';
    return `
      <section id="phone-home" class="${hidden}">
        <div id="phone-home-date">
          <span>${weekdayLabel()}</span>
          <strong>${calendarDay()}</strong>
          <small>${escapeHtml(locationLabel)}</small>
        </div>
        <div id="phone-app-grid" aria-label="Apps">
          ${appButton('profile', 'profile', 'profile', 'Profile')}
          ${appButton('wallet', 'wallet', 'wallet', 'Wallet')}
          ${this.activityContext
            ? appButton('jobs', 'briefcase-business', 'jobs', 'Jobs')
            : disabledAppButton('briefcase-business', 'jobs', 'Jobs')}
          ${disabledAppButton('map', 'maps', 'Maps')}
          ${disabledAppButton('car-front', 'garage', 'Garage')}
          ${disabledAppButton('settings', 'settings', 'Settings')}
          ${disabledAppButton('radio', 'radio', 'Radio')}
          ${disabledAppButton('users', 'crew', 'Crew')}
        </div>
        <div id="phone-page-dots" aria-hidden="true"><i></i><i></i></div>
        <div id="phone-dock" aria-label="Dock">
          ${disabledAppButton('phone', 'phone', 'Phone')}
          ${disabledAppButton('message-circle', 'messages', 'Messages')}
          ${appButton('wallet', 'wallet', 'wallet', 'Wallet')}
          ${disabledAppButton('music-2', 'music', 'Music')}
        </div>
      </section>
    `;
  }

  private renderProfile(): string {
    const hidden = this.activeApp === 'profile' ? '' : ' hidden';
    const profile = readProfileSnapshot(this.localPlayer);
    return `
      <section id="phone-profile-app-screen" class="${hidden}" data-auth="${profile.walletAddress ? 'privy' : 'guest'}">
        <header id="phone-app-header">
          <button class="phone-back-button" type="button" data-app="home" aria-label="Back to Home Screen">${phoneGlyph('chevron-left')}<span>Home</span></button>
          <button id="profile-refresh" class="phone-header-action" type="button" aria-label="Refresh profile">${phoneGlyph('refresh-cw')}</button>
        </header>
        <div id="profile-body">
          <h1>Profile</h1>
          <section class="profile-hero-card ${profile.walletAddress ? 'connected' : 'guest'}">
            <div class="profile-avatar">${phoneGlyph('user-round')}</div>
            <div><strong>${escapeHtml(profile.driverName)}</strong><span>${profile.authLabel}</span></div>
            ${phoneGlyph('chevron-right')}
          </section>
          <section class="profile-wallet-card ${profile.walletAddress ? 'ready' : 'missing'}">
            <i class="profile-row-icon wallet">${phoneGlyph('wallet')}</i>
            <div><strong>Wallet</strong><span>${escapeHtml(profile.walletAddress ? shortAddress(profile.walletAddress) : 'Not connected')}</span></div>
            <b>${profile.walletAddress ? 'Ready' : 'Off'}</b>
          </section>
          <section class="profile-card">
            <h2>Driver</h2>
            <dl>
              ${profileRow('banknote', 'Cash', profile.cash)}
              ${profileRow('heart-pulse', 'Health', profile.health)}
              ${profileRow('crosshair', 'Weapon', profile.weapon)}
              ${profileRow('shirt', 'Outfit', profile.outfitName)}
            </dl>
          </section>
          <section class="profile-card">
            <h2>Appearance</h2>
            <dl>
              ${profileRow('scissors', 'Hair', profile.hair)}
              ${profileRow('hard-hat', 'Hat', profile.hat)}
              ${profileRow('shirt', 'Top', profile.top)}
              ${profileRow('person-standing', 'Legs', profile.legs)}
              ${profileRow('footprints', 'Shoes', profile.shoes)}
            </dl>
          </section>
        </div>
      </section>
    `;
  }

  private renderWallet(): string {
    const hidden = this.activeApp === 'wallet' ? '' : ' hidden';
    const profile = readProfileSnapshot(this.localPlayer);
    const walletAddress = profile.walletAddress;
    return `
      <section id="phone-wallet-app-screen" class="${hidden}">
        <header id="wallet-app-header">
          <button class="phone-back-button" type="button" data-app="home" aria-label="Back to Home Screen">${phoneGlyph('chevron-left')}<span>Home</span></button>
          <button id="wallet-refresh" class="phone-header-action" type="button" aria-label="Refresh wallet">${phoneGlyph('refresh-cw')}</button>
        </header>
        <div id="wallet-body">
          <h1>Wallet</h1>
          <section class="wallet-hero ${walletAddress ? '' : 'missing'}">
            <header><span>Nock Wallet</span><b>Chain 4663</b></header>
            <small>${walletAddress ? 'Total Balance' : 'Wallet unavailable'}</small>
            <strong>${walletAddress ? '0.0000 ETH' : '--'}</strong>
            <p>${escapeHtml(walletAddress ? shortAddress(walletAddress) : 'Connect a wallet to view assets')}</p>
            <div class="wallet-actions">
              <button id="wallet-receive" type="button" ${walletAddress ? '' : 'disabled'}>${phoneGlyph('arrow-down')}<span>Receive</span></button>
              <button type="button" disabled>${phoneGlyph('arrow-up')}<span>Send</span></button>
              <button type="button" disabled>${phoneGlyph('arrow-left-right')}<span>Swap</span></button>
              <button type="button" disabled>${phoneGlyph('plus')}<span>Buy</span></button>
            </div>
          </section>
          <section class="wallet-address-card">
            <div><span>Wallet Address</span><strong>${escapeHtml(walletAddress ? shortAddress(walletAddress) : 'No address')}</strong></div>
            ${walletAddress ? `<button id="wallet-copy-address" type="button" aria-label="Copy wallet address">${phoneGlyph('copy')}</button>` : `<i>${phoneGlyph('link-2-off')}</i>`}
          </section>
          <section class="wallet-token-card">
            <header><strong>Assets</strong><span>Local preview</span></header>
            <ul>
              <li>
                <i class="token-ethereum">${phoneGlyph('gem')}</i>
                <div><strong>Ethereum</strong><span>${walletAddress ? 'Chain 4663' : 'Wallet required'}</span></div>
                <b>${walletAddress ? '0.0000' : '--'}</b>
              </li>
              <li class="pending">
                <i class="token-cashcat">C</i>
                <div><strong>Cashcat</strong><span>Metadata pending</span></div>
                <b>--</b>
              </li>
            </ul>
          </section>
        </div>
      </section>
    `;
  }

  private renderJobs(): string {
    const hidden = this.activeApp === 'jobs' ? '' : ' hidden';
    const context = this.activityContext;
    if (!context) {
      return `
        <section id="phone-jobs-app-screen" class="${hidden}">
          <header id="jobs-app-header">
            <button class="phone-back-button" type="button" data-app="home" aria-label="Back to Home Screen">${phoneGlyph('chevron-left')}<span>Home</span></button>
          </header>
          <div id="jobs-body">
            <h1>Jobs</h1>
            <p class="phone-activity-empty">Activities are unavailable in this session.</p>
          </div>
        </section>
      `;
    }
    const activity = projectPhoneActivity(context.currentWorld);
    return `
      <section id="phone-jobs-app-screen" class="${hidden}">
        <header id="jobs-app-header">
          <button class="phone-back-button" type="button" data-app="home" aria-label="Back to Home Screen">${phoneGlyph('chevron-left')}<span>Home</span></button>
          <span>${escapeHtml(activity.locationLabel)}</span>
        </header>
        <div id="jobs-body">
          <h1>Jobs</h1>
          <section class="phone-activity-card">
            <i>${phoneGlyph('car-front')}</i>
            <div>
              <small>${escapeHtml(activity.meta)}</small>
              <strong>${escapeHtml(activity.title)}</strong>
              <p>${escapeHtml(activity.description)}</p>
            </div>
            <button
              id="phone-activity-action"
              type="button"
              data-destination="${activity.destination}"
              ${context.busy ? 'disabled' : ''}
            >${context.busy ? 'Traveling…' : escapeHtml(activity.actionLabel)}</button>
          </section>
        </div>
      </section>
    `;
  }

  private readonly handleCloseClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private readonly handleClosePointerDown = (event: Event): void => {
    if (event instanceof PointerEvent && event.pointerType === 'mouse' && event.button !== 0) return;
    this.handleCloseClick(event);
  };

  private readonly handleAppClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) return;
    const app = target.dataset.app;
    if (app === 'home' || app === 'profile' || app === 'wallet' || app === 'jobs') {
      this.activeApp = app;
      this.render();
    }
  };

  private readonly handleActivityClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const context = this.activityContext;
    if (!(target instanceof HTMLButtonElement) || !context || context.busy) return;
    const destination = target.dataset.destination;
    if (destination !== 'industrial-district' && destination !== 'raceway') return;
    this.close();
    void context.onTravel(destination);
  };

  private readonly handleRefreshClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.render();
  };

  private readonly handleCopyWalletAddress = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const walletAddress = readWalletAddress();
    if (!walletAddress) return;
    void navigator.clipboard?.writeText(walletAddress).catch(() => undefined);
  };
}

function readProfileSnapshot(player?: NetworkPlayer): {
  authLabel: string;
  cash: string;
  driverName: string;
  hair: string;
  hat: string;
  health: string;
  legs: string;
  outfitName: string;
  shoes: string;
  top: string;
  walletAddress?: string;
  weapon: string;
} {
  const appearance = player?.appearance ?? loadSavedAppearance();
  const recipe = parseLpcRecipe(appearance.lpcRecipe) ??
    parseLpcRecipe(readStorage(LPC_STORAGE_KEY) ?? undefined);
  return {
    authLabel: readWalletAddress() ? 'Wallet session' : 'Guest session',
    cash: player ? `$${Math.max(0, Math.floor(player.cash))}` : 'Not spawned',
    driverName: player?.name ?? readStorage(DRIVER_NAME_KEY) ?? 'Guest driver',
    hair: recipe ? labelFor(LPC_HAIR_OPTIONS, recipe.hair) : appearance.hairStyle,
    hat: recipe ? labelFor(LPC_HAT_OPTIONS, recipe.hat) : appearance.headwear,
    health: player ? String(Math.max(0, Math.ceil(player.health))) : 'Not spawned',
    legs: recipe ? labelFor(LPC_LEGS_OPTIONS, recipe.legs) : appearance.bottomStyle,
    outfitName: appearance.outfitName,
    shoes: recipe ? labelFor(LPC_SHOE_OPTIONS, recipe.shoes) : appearance.shoeStyle,
    top: recipe ? labelFor(LPC_TOP_OPTIONS, recipe.top) : appearance.topStyle,
    walletAddress: readWalletAddress(),
    weapon: player?.weapon ?? 'None'
  };
}

function appButton(
  app: 'profile' | 'wallet' | 'jobs',
  icon: PhoneGlyphName,
  iconClass: string,
  label: string
): string {
  return `<button type="button" data-app="${app}" aria-label="Open ${label}"><i class="phone-app-icon ${iconClass}">${phoneGlyph(icon)}</i><span>${label}</span></button>`;
}

function disabledAppButton(icon: PhoneGlyphName, iconClass: string, label: string): string {
  return `<button type="button" disabled aria-label="${label}, coming soon"><i class="phone-app-icon ${iconClass}">${phoneGlyph(icon)}</i><span>${label}</span></button>`;
}

function profileRow(icon: PhoneGlyphName, label: string, value: string): string {
  return `<div><i class="profile-row-icon">${phoneGlyph(icon)}</i><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function readWalletAddress(): string | undefined {
  for (const key of WALLET_ADDRESS_KEYS) {
    const value = readStorage(key);
    if (value) return value;
  }
  return undefined;
}

function readStorage(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

function labelFor<T extends string>(options: readonly LpcOption<T>[], id: T): string {
  return options.find((option) => option.id === id)?.label ?? id;
}

function currentClock(date: Date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function weekdayLabel(date: Date = new Date()): string {
  return date.toLocaleDateString(undefined, {weekday: 'long'});
}

function calendarDay(date: Date = new Date()): string {
  return String(date.getDate());
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

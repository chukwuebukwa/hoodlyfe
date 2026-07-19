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
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';

const DRIVER_NAME_KEY = 'nock0-driver-name';
const LPC_STORAGE_KEY = 'nock0-lpc-recipe';
const WALLET_ADDRESS_KEYS = [
  'nock0-wallet-address',
  'nock0-privy-wallet-address',
  'privy-wallet-address'
];

export class NockPhoneController {
  private static shared?: NockPhoneController;
  private readonly button: HTMLButtonElement | null;
  private popup?: HTMLElement;
  private activeApp: 'home' | 'profile' | 'wallet' = 'home';
  private localPlayer?: NetworkPlayer;

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
  }

  isOpen(): boolean {
    return Boolean(this.popup && !this.popup.classList.contains('hidden'));
  }

  synchronize(state: DistrictNetworkState, localPlayerId: string): void {
    this.localPlayer = state.players.get(localPlayerId);
    if (this.isOpen()) this.render();
  }

  destroy(): void {
    this.button?.removeEventListener('click', this.handleButtonClick);
    this.root.removeEventListener('keydown', this.handleKeyDown);
    this.popup?.remove();
    this.popup = undefined;
    this.button?.setAttribute('aria-expanded', 'false');
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

  private open(app: 'home' | 'profile' | 'wallet'): void {
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
    popup.setAttribute('aria-label', 'Nock phone');
    this.root.body.append(popup);
    this.popup = popup;
    return popup;
  }

  private render(): void {
    const popup = this.ensurePopup();
    popup.dataset.app = this.activeApp;
    popup.innerHTML = `
      <header id="phone-status-bar">
        <span>NOCK</span>
        <strong>${currentClock()}</strong>
        <button id="profile-close" type="button" aria-label="Close phone">x</button>
      </header>
      <main id="phone-screen">
        ${this.renderHome()}
        ${this.renderProfile()}
        ${this.renderWallet()}
      </main>
      <nav id="phone-nav" aria-label="Phone apps">
        <button id="phone-nav-home" type="button" data-app="home"><i>HM</i><span>Home</span></button>
        <button id="phone-nav-profile" type="button" data-app="profile"><i>PR</i><span>Profile</span></button>
        <button id="phone-nav-wallet" type="button" data-app="wallet"><i>WA</i><span>Wallet</span></button>
      </nav>
    `;
    popup.querySelector('#profile-close')?.addEventListener('click', this.handleCloseClick);
    popup.querySelectorAll<HTMLButtonElement>('[data-app]').forEach((button) => {
      button.addEventListener('click', this.handleAppClick);
    });
    popup.querySelector('#wallet-copy-address')?.addEventListener('click', this.handleCopyWalletAddress);
    popup.querySelector('#wallet-refresh')?.addEventListener('click', this.handleRefreshClick);
  }

  private renderHome(): string {
    const hidden = this.activeApp === 'home' ? '' : ' hidden';
    return `
      <section id="phone-home" class="${hidden}">
        <div id="phone-app-grid">
          ${appButton('profile', 'PR', 'Profile', 'Driver account')}
          ${appButton('wallet', 'WA', 'Wallet', 'Tokens + chain')}
          ${disabledAppButton('JB', 'Jobs', 'Coming soon')}
          ${disabledAppButton('MP', 'Map', 'District GPS')}
          ${disabledAppButton('GR', 'Garage', 'Vehicles')}
          ${disabledAppButton('ST', 'Settings', 'Options')}
          ${disabledAppButton('RD', 'Radio', 'Stations')}
          ${disabledAppButton('CM', 'Crew', 'Contacts')}
        </div>
        <div id="phone-search-pill">Search</div>
        <div id="phone-dock">
          ${appButton('profile', 'PH', 'Phone', 'Profile')}
          ${appButton('wallet', 'SA', 'Wallet', 'Assets')}
          ${disabledAppButton('MS', 'Messages', 'Soon')}
          ${disabledAppButton('MU', 'Music', 'Soon')}
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
          <button type="button" data-app="home" aria-label="Back to home">&lt;</button>
          <div><strong>Profile</strong><span>${profile.authLabel}</span></div>
        </header>
        <div id="profile-body">
          <section class="profile-hero-card ${profile.walletAddress ? 'connected' : 'guest'}">
            <span>${profile.walletAddress ? 'Wallet ready' : 'Local driver'}</span>
            <strong>${escapeHtml(profile.driverName)}</strong>
            <p>${profile.walletAddress
              ? 'This driver has a wallet address available in local state.'
              : 'Login wallet sync is not connected in this wrapper yet. Local character and driver state still work.'}</p>
          </section>
          <section class="profile-wallet-card ${profile.walletAddress ? 'ready' : 'missing'}">
            <header><strong>Wallet</strong><span>${profile.walletAddress ? 'Ready' : 'Missing'}</span></header>
            <p>${escapeHtml(profile.walletAddress ?? 'No wallet address found')}</p>
            <small>${profile.walletAddress ? 'Use the Wallet app for token display.' : 'Once Privy wallet state is bridged into the client, this will populate here.'}</small>
          </section>
          <section class="profile-card">
            <header><strong>Driver</strong><span>Live district</span></header>
            <dl>
              ${profileRow('Cash', profile.cash)}
              ${profileRow('Health', profile.health)}
              ${profileRow('Weapon', profile.weapon)}
              ${profileRow('Outfit', profile.outfitName)}
            </dl>
          </section>
          <section class="profile-card">
            <header><strong>Character</strong><span>LPC recipe</span></header>
            <dl>
              ${profileRow('Hair', profile.hair)}
              ${profileRow('Hat', profile.hat)}
              ${profileRow('Top', profile.top)}
              ${profileRow('Legs', profile.legs)}
              ${profileRow('Shoes', profile.shoes)}
            </dl>
          </section>
        </div>
        <footer>
          <button type="button" id="profile-refresh">REFRESH</button>
          <button type="button" id="profile-logout">LOG OUT</button>
        </footer>
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
          <button type="button" data-app="home" aria-label="Back to home">&lt;</button>
          <div><strong>Wallet</strong><span>${walletAddress ? shortAddress(walletAddress) : 'No address'}</span></div>
          <button id="wallet-refresh" type="button">Refresh</button>
        </header>
        <div id="wallet-body">
          <section class="wallet-hero ${walletAddress ? '' : 'missing'}">
            <header><span>${walletAddress ? 'Connected address' : 'Wallet unavailable'}</span><b>Chain 4663</b></header>
            <strong>${walletAddress ? '0.0000 ETH' : '--'}</strong>
            <p>${walletAddress
              ? 'Native balance display is ready for the chain API bridge.'
              : 'No wallet address is available to query yet.'}</p>
            <div class="wallet-actions">
              <button id="wallet-receive" type="button" ${walletAddress ? '' : 'disabled'}>Receive</button>
              <button type="button" disabled>Send</button>
              <button type="button" disabled>Swap</button>
              <button type="button" disabled>Buy</button>
            </div>
          </section>
          <section class="wallet-address-card">
            <span>Address</span>
            <strong>${escapeHtml(walletAddress ?? 'No wallet address found')}</strong>
            ${walletAddress ? `<button id="wallet-copy-address" type="button">Copy Address</button>` : ''}
          </section>
          <section class="wallet-search-card">
            <span>Token images and balances can load here once the wallet bridge is connected.</span>
          </section>
          <section class="wallet-token-card">
            <header><strong>Tokens</strong><span>Local preview</span></header>
            <ul>
              <li>
                <i>ETH</i>
                <div><strong>Ethereum</strong><span>${walletAddress ? 'Chain 4663 native' : 'Wallet required'}</span></div>
                <b>${walletAddress ? '0.0000' : '--'}</b>
              </li>
              <li class="pending">
                <i>CC</i>
                <div><strong>Cashcat</strong><span>Dexscreener metadata pending</span></div>
                <b>--</b>
              </li>
            </ul>
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

  private readonly handleAppClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) return;
    const app = target.dataset.app;
    if (app === 'home' || app === 'profile' || app === 'wallet') {
      this.activeApp = app;
      this.render();
    }
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

function appButton(app: 'profile' | 'wallet', icon: string, label: string, sublabel: string): string {
  return `<button type="button" data-app="${app}"><i>${icon}</i><span>${label}<small>${sublabel}</small></span></button>`;
}

function disabledAppButton(icon: string, label: string, sublabel: string): string {
  return `<button type="button" disabled><i>${icon}</i><span>${label}<small>${sublabel}</small></span></button>`;
}

function profileRow(label: string, value: string): string {
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
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

import {
  getPrivyProfile,
  isPrivyBrowserAuthConfigured,
  loginPrivyWithEmailCode,
  logoutPrivyProfile,
  sendPrivyEmailCode,
  type PrivyProfileSummary
} from './privy-email-auth.ts';
import {loadSavedAppearance} from '../appearance/appearance-storage.ts';

export function mountPrivyProfilePopup(): {destroy(): void} {
  const button = document.querySelector<HTMLButtonElement>('#phone-button');
  if (!button) return {destroy: () => undefined};

  let popup: HTMLElement | undefined;

  const close = (): void => {
    popup?.remove();
    popup = undefined;
    button.setAttribute('aria-expanded', 'false');
  };

  const open = (): void => {
    if (popup) {
      close();
      return;
    }
    popup = renderShell();
    const activePopup = popup;
    document.body.append(activePopup);
    button.setAttribute('aria-expanded', 'true');
    const closeButton = required<HTMLButtonElement>(activePopup, '#profile-close');
    const homeButton = required<HTMLButtonElement>(activePopup, '#phone-home-button');
    const profileApp = required<HTMLButtonElement>(activePopup, '#phone-profile-app');
    const refreshButton = required<HTMLButtonElement>(activePopup, '#profile-refresh');
    const logoutButton = required<HTMLButtonElement>(activePopup, '#profile-logout');
    const sendCodeButton = required<HTMLButtonElement>(activePopup, '#profile-send-code');
    const loginButton = required<HTMLButtonElement>(activePopup, '#profile-login');
    closeButton.addEventListener('click', close);
    homeButton.addEventListener('click', () => showPhoneHome(activePopup));
    profileApp.addEventListener('click', () => {
      showPhoneApp(activePopup, 'profile');
      void refresh(activePopup);
    });
    refreshButton.addEventListener('click', () => void refresh(activePopup));
    sendCodeButton.addEventListener('click', () => void sendProfileCode(activePopup));
    loginButton.addEventListener('click', () => void loginProfile(activePopup));
    logoutButton.addEventListener('click', () => {
      logoutButton.disabled = true;
      void logoutPrivyProfile().then(() => refresh(activePopup)).finally(() => {
        logoutButton.disabled = false;
      });
    });
    showPhoneHome(activePopup);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  button.addEventListener('click', open);
  window.addEventListener('keydown', onKeyDown);

  return {
    destroy: () => {
      close();
      button.removeEventListener('click', open);
      window.removeEventListener('keydown', onKeyDown);
    }
  };
}

async function refresh(root: HTMLElement | undefined): Promise<void> {
  if (!root) return;
  const body = required<HTMLElement>(root, '#profile-body');
  setProfileStatus(root, 'Loading Privy session...');
  if (!isPrivyBrowserAuthConfigured()) {
    setProfileStatus(root, 'Privy app id is not configured.');
    renderProfile(body, guestProfile());
    return;
  }
  try {
    renderProfile(body, await getPrivyProfile());
    setProfileStatus(root, 'Ready');
  } catch (error) {
    renderProfile(body, guestProfile());
    setProfileStatus(root, error instanceof Error ? error.message : 'Unable to load profile.');
  }
}

async function sendProfileCode(root: HTMLElement | undefined): Promise<void> {
  if (!root) return;
  const email = required<HTMLInputElement>(root, '#profile-email');
  setProfileStatus(root, 'Sending code...');
  try {
    await sendPrivyEmailCode(email.value);
    setProfileStatus(root, 'Code sent. Check email.');
    required<HTMLInputElement>(root, '#profile-code').focus();
  } catch (error) {
    setProfileStatus(root, error instanceof Error ? error.message : 'Unable to send code.');
  }
}

async function loginProfile(root: HTMLElement | undefined): Promise<void> {
  if (!root) return;
  const email = required<HTMLInputElement>(root, '#profile-email');
  const code = required<HTMLInputElement>(root, '#profile-code');
  setProfileStatus(root, 'Verifying code...');
  try {
    await loginPrivyWithEmailCode(email.value, code.value);
    await refresh(root);
  } catch (error) {
    setProfileStatus(root, error instanceof Error ? error.message : 'Unable to log in.');
  }
}

function renderShell(): HTMLElement {
  const popup = document.createElement('section');
  popup.id = 'profile-popup';
  popup.className = 'hud-layer';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'NOCK phone');
  popup.innerHTML = `
    <header id="phone-status-bar">
      <span>NOCK</span>
      <strong id="phone-clock">${phoneTime()}</strong>
      <button id="profile-close" type="button" aria-label="Close profile">X</button>
    </header>
    <main id="phone-screen">
      <section id="phone-home" aria-label="Phone apps">
        <header><strong>NOCKPHONE</strong><span>District OS</span></header>
        <div id="phone-app-grid">
          <button id="phone-profile-app" type="button"><i>PR</i><span>Profile</span></button>
          <button type="button" disabled><i>MS</i><span>Messages</span></button>
          <button type="button" disabled><i>JB</i><span>Jobs</span></button>
          <button type="button" disabled><i>MP</i><span>Map</span></button>
          <button type="button" disabled><i>GR</i><span>Garage</span></button>
          <button type="button" disabled><i>ST</i><span>Settings</span></button>
        </div>
      </section>
      <section id="phone-profile-app-screen" class="hidden" aria-label="Profile app">
        <header id="phone-app-header">
          <button id="phone-home-button" type="button" aria-label="Back to phone home">&lt;</button>
          <div><strong>Profile</strong><span>Privy Session</span></div>
        </header>
        <section id="profile-login-panel" aria-label="Profile login">
          <div>
            <input id="profile-email" type="email" autocomplete="email" placeholder="email@domain.com">
            <button id="profile-send-code" type="button">SEND CODE</button>
          </div>
          <div>
            <input id="profile-code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000">
            <button id="profile-login" type="button">LOGIN</button>
          </div>
          <p id="profile-status">Loading...</p>
        </section>
        <div id="profile-body"></div>
        <footer>
          <button id="profile-refresh" type="button">REFRESH</button>
          <button id="profile-logout" type="button">LOG OUT</button>
        </footer>
      </section>
    </main>
    <footer id="phone-nav">
      <button id="phone-home-button-visual" type="button" aria-hidden="true" tabindex="-1"></button>
    </footer>
  `;
  return popup;
}

function showPhoneHome(root: HTMLElement): void {
  required<HTMLElement>(root, '#phone-home').classList.remove('hidden');
  required<HTMLElement>(root, '#phone-profile-app-screen').classList.add('hidden');
}

function showPhoneApp(root: HTMLElement, app: 'profile'): void {
  required<HTMLElement>(root, '#phone-home').classList.add('hidden');
  if (app === 'profile') {
    required<HTMLElement>(root, '#phone-profile-app-screen').classList.remove('hidden');
  }
}

function phoneTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function renderProfile(root: HTMLElement, profile: PrivyProfileSummary): void {
  const appScreen = root.closest<HTMLElement>('#phone-profile-app-screen');
  if (appScreen) appScreen.dataset.auth = profile.status;
  const local = localCharacterSummary();
  const accounts = profile.accounts.length
    ? profile.accounts.map((account) => `
      <li class="profile-account-row">
        <i>${escapeHtml(accountBadge(account.type))}</i>
        <div>
          <span>${escapeHtml(accountLabel(account.type))}</span>
          <strong>${escapeHtml(account.address ?? account.email ?? account.subject ?? 'Linked account')}</strong>
        </div>
      </li>
    `).join('')
    : '<li class="profile-empty">No wallet or email account is linked yet.</li>';

  root.innerHTML = `
    <section class="profile-hero-card ${profile.status === 'privy' ? 'connected' : 'guest'}">
      <span>${profile.status === 'privy' ? 'Privy Login Connected' : 'Guest Session'}</span>
      <strong>${escapeHtml(profile.status === 'privy' ? profile.emailAddress ?? profile.label : local.driverName)}</strong>
      <p>${profile.status === 'privy'
        ? profile.walletAddress
          ? 'This driver has a wallet address linked for future inventory and persistence.'
          : 'This driver is logged in with Privy, but no wallet address exists yet.'
        : 'Sign in to attach this local driver to a persistent account and wallet.'}</p>
    </section>
    <section class="profile-wallet-card ${profile.walletAddress ? 'ready' : 'missing'}">
      <header><strong>Wallet</strong><span>${profile.walletAddress ? 'Linked' : 'Not created'}</span></header>
      <p>${escapeHtml(profile.walletAddress ?? 'No wallet address linked to this Privy user yet.')}</p>
      ${profile.status === 'privy' && !profile.walletAddress
        ? '<small>Email login is working. Next step is creating or linking an embedded wallet.</small>'
        : ''}
    </section>
    <section class="profile-card">
      <header><strong>Driver</strong><span>Local Save</span></header>
      <dl>
        <div><dt>Name</dt><dd>${escapeHtml(local.driverName)}</dd></div>
        <div><dt>Outfit</dt><dd>${escapeHtml(local.outfitName)}</dd></div>
        <div><dt>Character</dt><dd>${local.hasLpcRecipe ? 'Saved LPC recipe' : 'Default character'}</dd></div>
      </dl>
    </section>
    <section class="profile-card">
      <header><strong>Accounts</strong><span>${profile.accounts.length} linked</span></header>
      <ul>${accounts}</ul>
    </section>
    <details class="profile-tech-card">
      <summary>Privy details</summary>
      <dl>
        <div><dt>User ID</dt><dd>${escapeHtml(compactId(profile.userId))}</dd></div>
        <div><dt>Token</dt><dd>${profile.accessTokenPresent ? 'Ready for server verification' : 'Not available'}</dd></div>
      </dl>
    </details>
  `;
}

function guestProfile(): PrivyProfileSummary {
  return {
    status: 'guest',
    label: 'Guest driver',
    accessTokenPresent: false,
    accounts: []
  };
}

function localCharacterSummary(): {driverName: string; outfitName: string; hasLpcRecipe: boolean} {
  const appearance = loadSavedAppearance();
  return {
    driverName: readStorage('nock0-driver-name') ?? 'Driver',
    outfitName: appearance.outfitName ?? 'Local Outfit',
    hasLpcRecipe: Boolean(appearance.lpcRecipe)
  };
}

function setProfileStatus(root: HTMLElement, value: string): void {
  required<HTMLElement>(root, '#profile-status').textContent = value;
}

function accountBadge(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes('wallet')) return 'WA';
  if (normalized.includes('email')) return 'EM';
  if (normalized.includes('phone')) return 'PH';
  if (normalized.includes('google')) return 'GO';
  if (normalized.includes('discord')) return 'DI';
  return 'AC';
}

function accountLabel(type: string): string {
  return type.replace(/[_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactId(value: string | undefined): string {
  if (!value) return 'None';
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Profile popup is missing ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

function readStorage(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

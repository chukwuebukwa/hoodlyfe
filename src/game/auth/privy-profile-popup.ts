import {
  createPrivyEmbeddedWallet,
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
    const walletHomeButton = required<HTMLButtonElement>(activePopup, '#wallet-home-button');
    const profileApp = required<HTMLButtonElement>(activePopup, '#phone-profile-app');
    const walletApp = required<HTMLButtonElement>(activePopup, '#phone-wallet-app');
    const refreshButton = required<HTMLButtonElement>(activePopup, '#profile-refresh');
    const logoutButton = required<HTMLButtonElement>(activePopup, '#profile-logout');
    const sendCodeButton = required<HTMLButtonElement>(activePopup, '#profile-send-code');
    const loginButton = required<HTMLButtonElement>(activePopup, '#profile-login');
    const body = required<HTMLElement>(activePopup, '#profile-body');
    const walletRefreshButton = required<HTMLButtonElement>(activePopup, '#wallet-refresh');
    const walletBody = required<HTMLElement>(activePopup, '#wallet-body');
    const navHome = required<HTMLButtonElement>(activePopup, '#phone-nav-home');
    const navProfile = required<HTMLButtonElement>(activePopup, '#phone-nav-profile');
    const navWallet = required<HTMLButtonElement>(activePopup, '#phone-nav-wallet');
    closeButton.addEventListener('click', close);
    homeButton.addEventListener('click', () => showPhoneHome(activePopup));
    walletHomeButton.addEventListener('click', () => showPhoneHome(activePopup));
    navHome.addEventListener('click', () => showPhoneHome(activePopup));
    navProfile.addEventListener('click', () => {
      showPhoneApp(activePopup, 'profile');
      void refresh(activePopup);
    });
    navWallet.addEventListener('click', () => {
      showPhoneApp(activePopup, 'wallet');
      void refreshWallet(activePopup);
    });
    profileApp.addEventListener('click', () => {
      showPhoneApp(activePopup, 'profile');
      void refresh(activePopup);
    });
    walletApp.addEventListener('click', () => {
      showPhoneApp(activePopup, 'wallet');
      void refreshWallet(activePopup);
    });
    refreshButton.addEventListener('click', () => void refresh(activePopup));
    walletRefreshButton.addEventListener('click', () => void refreshWallet(activePopup));
    sendCodeButton.addEventListener('click', () => void sendProfileCode(activePopup));
    loginButton.addEventListener('click', () => void loginProfile(activePopup));
    body.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || target.id !== 'profile-create-wallet') return;
      void createWallet(activePopup, target);
    });
    walletBody.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.id === 'wallet-create-wallet') {
        void createWallet(activePopup, target).then(() => refreshWallet(activePopup));
        return;
      }
      if (target.id === 'wallet-receive') {
        void copyWalletAddress(target, activePopup);
      }
    });
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

async function createWallet(root: HTMLElement, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  setProfileStatus(root, 'Creating embedded wallet...');
  try {
    const profile = await createPrivyEmbeddedWallet();
    renderProfile(required<HTMLElement>(root, '#profile-body'), profile);
    setProfileStatus(root, profile.walletAddress ? 'Wallet created.' : 'Wallet creation returned no address.');
  } catch (error) {
    setProfileStatus(root, error instanceof Error ? error.message : 'Unable to create wallet.');
  } finally {
    button.disabled = false;
  }
}

async function refreshWallet(root: HTMLElement): Promise<void> {
  const body = required<HTMLElement>(root, '#wallet-body');
  body.innerHTML = '<p class="wallet-muted">Loading wallet...</p>';
  try {
    const profile = await getPrivyProfile();
    renderWallet(body, profile);
    const [balance, dexTokens] = await Promise.all([
      profile.walletAddress ? fetchRobinhoodNativeBalance(profile.walletAddress) : Promise.resolve(undefined),
      fetchDexscreenerRobinhoodTokens()
    ]);
    renderWallet(body, profile, balance, dexTokens);
  } catch (error) {
    body.innerHTML = `<p class="wallet-muted">${escapeHtml(error instanceof Error ? error.message : 'Unable to load wallet.')}</p>`;
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
        <div id="phone-app-grid">
          <button id="phone-profile-app" type="button"><i>PR</i><span>Profile</span></button>
          <button id="phone-wallet-app" type="button"><i>WA</i><span>Wallet</span></button>
          <button type="button" disabled><i>JB</i><span>Jobs</span></button>
          <button type="button" disabled><i>MP</i><span>Map</span></button>
          <button type="button" disabled><i>GR</i><span>Garage</span></button>
          <button type="button" disabled><i>ST</i><span>Settings</span></button>
          <button type="button" disabled><i>MSG</i><span>Messages</span></button>
          <button type="button" disabled><i>CAM</i><span>Camera</span></button>
        </div>
        <div id="phone-search-pill">Search</div>
        <div id="phone-dock">
          <button type="button" disabled><i>CALL</i><span>Phone</span></button>
          <button type="button" disabled><i>WEB</i><span>Web</span></button>
          <button type="button" disabled><i>TXT</i><span>Texts</span></button>
          <button type="button" disabled><i>MUS</i><span>Radio</span></button>
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
      <section id="phone-wallet-app-screen" class="hidden" aria-label="Wallet app">
        <header id="wallet-app-header">
          <button id="wallet-home-button" type="button" aria-label="Back to phone home">&lt;</button>
          <div><strong>Wallet</strong><span>Robinhood Chain</span></div>
          <button id="wallet-refresh" type="button">SYNC</button>
        </header>
        <div id="wallet-body"></div>
      </section>
    </main>
    <footer id="phone-nav">
      <button id="phone-nav-home" type="button" aria-label="Phone home"><i>HM</i><span>Home</span></button>
      <button id="phone-nav-profile" type="button" aria-label="Profile app"><i>PR</i><span>Profile</span></button>
      <button id="phone-nav-wallet" type="button" aria-label="Wallet app"><i>WA</i><span>Wallet</span></button>
    </footer>
  `;
  return popup;
}

function showPhoneHome(root: HTMLElement): void {
  root.dataset.app = 'home';
  required<HTMLElement>(root, '#phone-home').classList.remove('hidden');
  required<HTMLElement>(root, '#phone-profile-app-screen').classList.add('hidden');
  required<HTMLElement>(root, '#phone-wallet-app-screen').classList.add('hidden');
}

function showPhoneApp(root: HTMLElement, app: 'profile' | 'wallet'): void {
  root.dataset.app = app;
  required<HTMLElement>(root, '#phone-home').classList.add('hidden');
  required<HTMLElement>(root, '#phone-profile-app-screen').classList.toggle('hidden', app !== 'profile');
  required<HTMLElement>(root, '#phone-wallet-app-screen').classList.toggle('hidden', app !== 'wallet');
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
        ? '<small>Email login is working. Create an embedded wallet to get an address.</small><button id="profile-create-wallet" type="button">CREATE WALLET</button>'
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

function renderWallet(
  root: HTMLElement,
  profile: PrivyProfileSummary,
  nativeBalance?: {formatted: string; symbol: string},
  dexTokens: DexscreenerTokenMeta[] = []
): void {
  const hasWallet = Boolean(profile.walletAddress);
  const ethAmount = nativeBalance?.formatted ?? '0.0000';
  const tokenRows = [
    nativeTokenRow(ethAmount),
    ...dexTokens.slice(0, 6).map(dexTokenRow)
  ].join('');
  root.innerHTML = `
    <section class="wallet-hero ${hasWallet ? 'ready' : 'missing'}">
      <header>
        <span>Robinhood Chain</span>
        <b>${hasWallet ? escapeHtml(compactWallet(profile.walletAddress ?? '')) : 'No wallet'}</b>
      </header>
      <strong>${ethAmount} ${nativeBalance?.symbol ?? 'ETH'}</strong>
      <p>${hasWallet ? 'Native balance on chain 4663' : 'Create a wallet to start tracking balances.'}</p>
      <div class="wallet-actions">
        <button id="wallet-receive" type="button" ${hasWallet ? `data-address="${escapeHtml(profile.walletAddress ?? '')}"` : 'disabled'}>Receive</button>
        <button type="button" disabled>Send</button>
        <button type="button" disabled>Swap</button>
        <button type="button" disabled>Buy</button>
      </div>
    </section>
    ${hasWallet ? `
      <section class="wallet-address-card">
        <span>Address</span>
        <strong>${escapeHtml(compactMiddle(profile.walletAddress ?? '', 14, 10))}</strong>
        <a href="${robinhoodExplorerAddress(profile.walletAddress ?? '')}" target="_blank" rel="noreferrer">View Explorer</a>
      </section>
    ` : `
      <section class="wallet-address-card missing">
        <span>Wallet setup</span>
        <strong>Create an embedded wallet to receive a Robinhood Chain address.</strong>
        <button id="wallet-create-wallet" type="button">CREATE WALLET</button>
      </section>
    `}
    <section class="wallet-search-card">
      <span>${dexTokens.length ? 'Images loaded from Dexscreener where available.' : 'Dexscreener has no Robinhood token images yet; add contracts/indexer for live token rows.'}</span>
    </section>
    <section class="wallet-token-card">
      <header><strong>Tokens</strong><span>${dexTokens.length ? 'Dexscreener metadata' : 'Live native balance'}</span></header>
      <ul>${tokenRows}</ul>
    </section>
  `;
}

async function copyWalletAddress(button: HTMLButtonElement, root: HTMLElement): Promise<void> {
  const address = button.dataset.address;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = 'Receive';
    }, 1200);
  } catch {
    const body = required<HTMLElement>(root, '#wallet-body');
    body.insertAdjacentHTML('afterbegin', '<p class="wallet-muted">Could not copy address.</p>');
  }
}

function nativeTokenRow(amount: string): string {
  return `
    <li>
      <i>ETH</i>
      <div><strong>Ethereum</strong><span>${amount} ETH</span></div>
      <b>${amount}</b>
    </li>
  `;
}

function dexTokenRow(token: DexscreenerTokenMeta): string {
  const icon = token.imageUrl
    ? `<img src="${escapeHtml(token.imageUrl)}" alt="">`
    : `<i>${escapeHtml(token.symbol.slice(0, 3).toUpperCase())}</i>`;
  return `
    <li class="dex-token">
      ${icon}
      <div><strong>${escapeHtml(token.name)}</strong><span>${escapeHtml(token.symbol)} / ${escapeHtml(token.chainId)}</span></div>
      <b>${token.priceUsd ? `$${escapeHtml(token.priceUsd)}` : '--'}</b>
    </li>
  `;
}

interface DexscreenerTokenMeta {
  chainId: string;
  address?: string;
  name: string;
  symbol: string;
  imageUrl?: string;
  priceUsd?: string;
  volume24h?: number;
}

async function fetchDexscreenerRobinhoodTokens(): Promise<DexscreenerTokenMeta[]> {
  const queries = ['cashcat', 'Robinhood Chain', 'Robinhood'];
  const results = await Promise.allSettled(queries.map(fetchDexscreenerSearch));
  const tokens = new Map<string, DexscreenerTokenMeta>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const token of result.value) {
      if (token.chainId !== 'robinhood') continue;
      const key = token.address ? `${token.chainId}:${token.address.toLowerCase()}` : `${token.chainId}:${token.symbol}:${token.name}`;
      const existing = tokens.get(key);
      if (!existing || (token.volume24h ?? 0) > (existing.volume24h ?? 0)) tokens.set(key, token);
    }
  }
  return [...tokens.values()]
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

async function fetchDexscreenerSearch(query: string): Promise<DexscreenerTokenMeta[]> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const payload = await response.json() as {pairs?: DexscreenerPair[]};
  return (payload.pairs ?? []).map((pair) => ({
    chainId: pair.chainId ?? 'unknown',
    address: pair.baseToken?.address,
    name: pair.baseToken?.name ?? pair.baseToken?.symbol ?? 'Token',
    symbol: pair.baseToken?.symbol ?? 'TOKEN',
    imageUrl: pair.info?.imageUrl,
    priceUsd: pair.priceUsd,
    volume24h: pair.volume?.h24
  }));
}

interface DexscreenerPair {
  chainId?: string;
  priceUsd?: string;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  volume?: {
    h24?: number;
  };
  info?: {
    imageUrl?: string;
  };
}

async function fetchRobinhoodNativeBalance(address: string): Promise<{formatted: string; symbol: string}> {
  const response = await fetch(robinhoodRpcUrl(), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest']
    })
  });
  if (!response.ok) throw new Error('Robinhood RPC request failed.');
  const payload = await response.json() as {result?: string; error?: {message?: string}};
  if (payload.error) throw new Error(payload.error.message ?? 'Robinhood RPC returned an error.');
  return {
    formatted: formatWei(payload.result ?? '0x0'),
    symbol: 'ETH'
  };
}

function robinhoodRpcUrl(): string {
  return publicEnv('VITE_ROBINHOOD_RPC_URL') ??
    publicEnv('NEXT_PUBLIC_ROBINHOOD_RPC_URL') ??
    'https://rpc.mainnet.chain.robinhood.com';
}

function publicEnv(name: string): string | undefined {
  const metaEnv = (import.meta as unknown as {env?: Record<string, string | undefined>}).env;
  const fromMeta = metaEnv?.[name];
  if (fromMeta) return fromMeta;
  if (typeof process === 'undefined') return undefined;
  return process.env[name];
}

function robinhoodExplorerAddress(address: string): string {
  return `https://robinhoodchain.blockscout.com/address/${encodeURIComponent(address)}`;
}

function formatWei(hexValue: string): string {
  const wei = BigInt(hexValue);
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = wei % 1_000_000_000_000_000_000n;
  const decimals = (fraction / 100_000_000_000_000n).toString().padStart(4, '0');
  return `${whole}.${decimals}`;
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

function compactWallet(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function compactMiddle(value: string, front: number, back: number): string {
  if (value.length <= front + back + 3) return value;
  return `${value.slice(0, front)}...${value.slice(-back)}`;
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

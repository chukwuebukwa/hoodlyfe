import type {ClientAuthPayload} from '../../../shared/protocol/auth.ts';

const DEFAULT_PRIVY_APP_ID = 'cmrh69i1o00mw0ckymhuo9qd7';

interface PrivyCoreClient {
  initialize(): Promise<void>;
  setMessagePoster(poster: unknown): void;
  getAccessToken(): Promise<string | null>;
  user: {
    get(): Promise<{user: unknown | null}>;
  };
  embeddedWallet: {
    create(input: Record<string, never>): Promise<{user: unknown}>;
    getURL(): string;
    onMessage(event: unknown): void;
  };
  auth: {
    logout(o?: {userId: string}): Promise<void>;
    email: {
      sendCode(email: string): Promise<{success: boolean}>;
      loginWithCode(email: string, code: string, mode?: 'login-or-sign-up'): Promise<{user: unknown}>;
    };
  };
}

let clientPromise: Promise<PrivyCoreClient> | undefined;
let embeddedWalletFrame: HTMLIFrameElement | undefined;
let embeddedWalletListener: ((event: MessageEvent) => void) | undefined;

export interface PrivyLoginResult {
  auth: ClientAuthPayload;
  label: string;
}

export interface PrivyLinkedAccountSummary {
  type: string;
  address?: string;
  email?: string;
  subject?: string;
}

export interface PrivyProfileSummary {
  status: 'guest' | 'privy';
  userId?: string;
  emailAddress?: string;
  walletAddress?: string;
  label: string;
  accessTokenPresent: boolean;
  accounts: PrivyLinkedAccountSummary[];
}

export function isPrivyBrowserAuthConfigured(): boolean {
  return Boolean(privyAppId());
}

export async function restorePrivyLogin(): Promise<PrivyLoginResult | undefined> {
  const client = await getPrivyClient();
  const {user} = await client.user.get();
  if (!user) return undefined;
  return loginResultFromUser(client, user);
}

export async function getPrivyProfile(): Promise<PrivyProfileSummary> {
  const client = await getPrivyClient();
  const {user} = await client.user.get();
  if (!user) {
    return {
      status: 'guest',
      label: 'Guest driver',
      accessTokenPresent: false,
      accounts: []
    };
  }
  const userRecord = isRecord(user) ? user : {};
  const accessToken = await client.getAccessToken();
  const accounts = linkedAccounts(userRecord);
  const walletAddress = firstWalletAddress(accounts);
  const emailAddress = firstEmailAddress(accounts);
  const userId = typeof userRecord.id === 'string' ? userRecord.id : undefined;
  return {
    status: 'privy',
    userId,
    emailAddress,
    walletAddress,
    label: walletAddress ? compactWallet(walletAddress) : emailAddress ?? userId ?? 'Privy user',
    accessTokenPresent: Boolean(accessToken),
    accounts
  };
}

export async function logoutPrivyProfile(): Promise<void> {
  const client = await getPrivyClient();
  const {user} = await client.user.get();
  const userRecord = isRecord(user) ? user : {};
  const userId = typeof userRecord.id === 'string' ? userRecord.id : undefined;
  await client.auth.logout(userId ? {userId} : undefined);
}

export async function createPrivyEmbeddedWallet(): Promise<PrivyProfileSummary> {
  const client = await getPrivyClient();
  const {user: currentUser} = await client.user.get();
  if (!currentUser) throw new Error('Log in before creating a wallet.');
  const {user} = await client.embeddedWallet.create({});
  const userRecord = isRecord(user) ? user : {};
  const accessToken = await client.getAccessToken();
  const accounts = linkedAccounts(userRecord);
  const walletAddress = firstWalletAddress(accounts);
  const emailAddress = firstEmailAddress(accounts);
  const userId = typeof userRecord.id === 'string' ? userRecord.id : undefined;
  return {
    status: 'privy',
    userId,
    emailAddress,
    walletAddress,
    label: walletAddress ? compactWallet(walletAddress) : emailAddress ?? userId ?? 'Privy user',
    accessTokenPresent: Boolean(accessToken),
    accounts
  };
}

export async function sendPrivyEmailCode(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Enter an email address first.');
  const client = await getPrivyClient();
  const result = await client.auth.email.sendCode(normalized);
  if (!result.success) throw new Error('Privy did not send a login code.');
}

export async function loginPrivyWithEmailCode(email: string, code: string): Promise<PrivyLoginResult> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = code.replace(/\s+/g, '');
  if (!normalizedEmail) throw new Error('Enter an email address first.');
  if (!normalizedCode) throw new Error('Enter the Privy code.');
  const client = await getPrivyClient();
  const session = await client.auth.email.loginWithCode(normalizedEmail, normalizedCode, 'login-or-sign-up');
  return loginResultFromUser(client, session.user);
}

async function getPrivyClient(): Promise<PrivyCoreClient> {
  if (!clientPromise) {
    clientPromise = createPrivyClient();
  }
  return clientPromise;
}

async function createPrivyClient(): Promise<PrivyCoreClient> {
  const appId = privyAppId();
  if (!appId) throw new Error('Missing Privy app id.');
  const {default: Privy, LocalStorage} = await import('@privy-io/js-sdk-core');
  const client = new Privy({
    appId,
    clientId: publicEnv('VITE_PRIVY_CLIENT_ID') ?? publicEnv('NEXT_PUBLIC_PRIVY_CLIENT_ID'),
    storage: new LocalStorage()
  }) as unknown as PrivyCoreClient;
  await client.initialize();
  mountEmbeddedWalletFrame(client);
  return client;
}

function mountEmbeddedWalletFrame(client: PrivyCoreClient): void {
  if (embeddedWalletFrame) {
    client.setMessagePoster(embeddedWalletFrame.contentWindow);
    return;
  }
  const iframe = document.createElement('iframe');
  iframe.src = client.embeddedWallet.getURL();
  iframe.title = 'Privy embedded wallet';
  iframe.style.display = 'none';
  document.body.append(iframe);
  embeddedWalletFrame = iframe;
  client.setMessagePoster(iframe.contentWindow);
  embeddedWalletListener = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const payload = typeof event.data === 'string' ? safeJsonParse(event.data) : event.data;
    if (payload) client.embeddedWallet.onMessage(payload);
  };
  window.addEventListener('message', embeddedWalletListener);
}

async function loginResultFromUser(client: PrivyCoreClient, user: unknown): Promise<PrivyLoginResult> {
  const accessToken = await client.getAccessToken();
  if (!accessToken) throw new Error('Privy did not return an access token.');
  const userRecord = isRecord(user) ? user : {};
  const accounts = linkedAccounts(userRecord);
  const walletAddress = firstWalletAddress(accounts);
  const userId = typeof userRecord.id === 'string' ? userRecord.id : undefined;
  return {
    auth: {
      provider: 'privy',
      accessToken,
      userId,
      walletAddress
    },
    label: walletAddress ? compactWallet(walletAddress) : userId ?? 'Privy user'
  };
}

function firstWalletAddress(accounts: PrivyLinkedAccountSummary[]): string | undefined {
  for (const account of accounts) {
    if (account.address && isWalletAccount(account)) return account.address;
  }
  return undefined;
}

function firstEmailAddress(accounts: PrivyLinkedAccountSummary[]): string | undefined {
  for (const account of accounts) {
    if (account.email) return account.email;
  }
  return undefined;
}

function linkedAccounts(user: Record<string, unknown>): PrivyLinkedAccountSummary[] {
  const rawAccounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user.linked_accounts)
      ? user.linked_accounts
      : [];
  return rawAccounts.filter(isRecord).map((account) => ({
    type: stringField(account, 'type') ?? stringField(account, 'connectorType') ?? 'account',
    address: stringField(account, 'address'),
    email: stringField(account, 'email') ?? stringField(account, 'emailAddress'),
    subject: stringField(account, 'subject')
  }));
}

function isWalletAccount(account: PrivyLinkedAccountSummary): boolean {
  const type = account.type.toLowerCase();
  return Boolean(account.address) && (
    type.includes('wallet') ||
    type.includes('ethereum') ||
    type.includes('solana') ||
    type.includes('metamask') ||
    type.includes('coinbase')
  );
}

function privyAppId(): string | undefined {
  return publicEnv('VITE_PRIVY_APP_ID') ?? publicEnv('NEXT_PUBLIC_PRIVY_APP_ID') ?? DEFAULT_PRIVY_APP_ID;
}

function publicEnv(name: string): string | undefined {
  const metaEnv = (import.meta as unknown as {env?: Record<string, string | undefined>}).env;
  const fromMeta = metaEnv?.[name];
  if (fromMeta) return fromMeta;
  if (typeof process === 'undefined') return undefined;
  return process.env[name];
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function compactWallet(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value ? value : undefined;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

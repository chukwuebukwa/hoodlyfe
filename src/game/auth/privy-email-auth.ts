import type {ClientAuthPayload} from '../../../shared/protocol/auth.ts';

const DEFAULT_PRIVY_APP_ID = 'cmrh69i1o00mw0ckymhuo9qd7';

interface PrivyCoreClient {
  initialize(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  user: {
    get(): Promise<{user: unknown | null}>;
  };
  auth: {
    email: {
      sendCode(email: string): Promise<{success: boolean}>;
      loginWithCode(email: string, code: string, mode?: 'login-or-sign-up'): Promise<{user: unknown}>;
    };
  };
}

let clientPromise: Promise<PrivyCoreClient> | undefined;

export interface PrivyLoginResult {
  auth: ClientAuthPayload;
  label: string;
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
  if (!appId) throw new Error('Missing VITE_PRIVY_APP_ID.');
  const {default: Privy, LocalStorage} = await import('@privy-io/js-sdk-core');
  const client = new Privy({
    appId,
    clientId: import.meta.env.VITE_PRIVY_CLIENT_ID,
    storage: new LocalStorage()
  }) as PrivyCoreClient;
  await client.initialize();
  return client;
}

async function loginResultFromUser(client: PrivyCoreClient, user: unknown): Promise<PrivyLoginResult> {
  const accessToken = await client.getAccessToken();
  if (!accessToken) throw new Error('Privy did not return an access token.');
  const userRecord = isRecord(user) ? user : {};
  const walletAddress = firstWalletAddress(userRecord);
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

function firstWalletAddress(user: Record<string, unknown>): string | undefined {
  const linkedAccounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user.linked_accounts)
      ? user.linked_accounts
      : [];
  for (const account of linkedAccounts) {
    if (!isRecord(account)) continue;
    const address = account.address;
    if (typeof address === 'string' && address) return address;
  }
  return undefined;
}

function privyAppId(): string | undefined {
  return import.meta.env.VITE_PRIVY_APP_ID ?? DEFAULT_PRIVY_APP_ID;
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

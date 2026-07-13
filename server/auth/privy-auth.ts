import {PrivyClient} from '@privy-io/node';
import type {ClientAuthPayload, VerifiedAuthIdentity} from '../../shared/protocol/auth.ts';

const DEFAULT_PRIVY_APP_ID = 'cmrh69i1o00mw0ckymhuo9qd7';

let privyClient: PrivyClient | undefined;

export async function verifyClientAuth(auth: ClientAuthPayload | undefined): Promise<VerifiedAuthIdentity> {
  if (auth?.provider !== 'privy') return {provider: 'guest'};
  const client = getPrivyClient();
  if (!client) return {provider: 'guest'};

  try {
    const payload = await client.utils().auth().verifyAccessToken(auth.accessToken);
    return {
      provider: 'privy',
      userId: payload.user_id,
      walletAddress: auth.walletAddress
    };
  } catch (error) {
    console.warn('Privy access token verification failed.', error);
    return {provider: 'guest'};
  }
}

function getPrivyClient(): PrivyClient | undefined {
  if (privyClient) return privyClient;
  const appId = process.env.PRIVY_APP_ID ?? process.env.VITE_PRIVY_APP_ID ?? DEFAULT_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appSecret) return undefined;
  privyClient = new PrivyClient({appId, appSecret});
  return privyClient;
}

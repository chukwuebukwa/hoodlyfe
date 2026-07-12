export type ClientAuthPayload =
  | {provider: 'guest'}
  | {
      provider: 'privy';
      accessToken: string;
      userId?: string;
      walletAddress?: string;
    };

export interface VerifiedAuthIdentity {
  provider: 'guest' | 'privy';
  userId?: string;
  walletAddress?: string;
}

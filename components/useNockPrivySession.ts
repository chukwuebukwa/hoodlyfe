'use client';

import {usePrivy} from '@privy-io/react-auth';
import {useEffect, useMemo, useState} from 'react';
import type {ClientAuthPayload} from '../shared/protocol/auth.ts';

export interface NockPrivySession {
  ready: boolean;
  authenticated: boolean;
  userId?: string;
  walletAddress?: string;
  accessToken?: string;
  authPayload: ClientAuthPayload;
}

export function useNockPrivySession(): NockPrivySession {
  const {ready, authenticated, user, getAccessToken} = usePrivy();
  const [accessToken, setAccessToken] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    if (!ready || !authenticated) {
      setAccessToken(undefined);
      return;
    }
    void getAccessToken().then((token) => {
      if (!alive) return;
      setAccessToken(token ?? undefined);
    }).catch(() => {
      if (!alive) return;
      setAccessToken(undefined);
    });
    return () => {
      alive = false;
    };
  }, [ready, authenticated, getAccessToken, user?.id]);

  const userId = user?.id;
  const walletAddress = useMemo(() => firstWalletAddress(user), [user]);
  const authPayload = useMemo<ClientAuthPayload>(() => {
    if (!accessToken) return {provider: 'guest'};
    return {
      provider: 'privy',
      accessToken,
      userId,
      walletAddress
    };
  }, [accessToken, userId, walletAddress]);

  return {
    ready,
    authenticated,
    userId,
    walletAddress,
    accessToken,
    authPayload
  };
}

function firstWalletAddress(user: unknown): string | undefined {
  if (!isRecord(user)) return undefined;
  const directWallet = isRecord(user.wallet) ? stringField(user.wallet, 'address') : undefined;
  if (directWallet) return directWallet;
  const linkedAccounts = Array.isArray(user.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user.linked_accounts)
      ? user.linked_accounts
      : [];
  for (const account of linkedAccounts) {
    if (!isRecord(account)) continue;
    const address = stringField(account, 'address');
    const type = stringField(account, 'type') ?? stringField(account, 'connectorType') ?? '';
    if (address && isWalletType(type)) return address;
  }
  return undefined;
}

function isWalletType(type: string): boolean {
  const normalized = type.toLowerCase();
  return normalized.includes('wallet') ||
    normalized.includes('ethereum') ||
    normalized.includes('solana') ||
    normalized.includes('embedded');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value ? value : undefined;
}

'use client';

import {useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import type {ClientAuthPayload} from '../shared/protocol/auth.ts';
import type {GameRuntime} from '../src/main.ts';
import {isDevelopmentQaGuest} from './development-qa-session.ts';
import {useNockPrivySession} from './useNockPrivySession';

export function GameRuntimeMount(): ReactElement {
  const [qaGuest, setQaGuest] = useState(false);
  useEffect(() => setQaGuest(isDevelopmentQaGuest()), []);
  return qaGuest
    ? <DevelopmentQaGameRuntimeMount />
    : <PrivyGameRuntimeMount />;
}

function DevelopmentQaGameRuntimeMount(): null {
  useGameRuntime(true, {provider: 'guest'});
  return null;
}

function PrivyGameRuntimeMount(): null {
  const privy = useNockPrivySession();
  useGameRuntime(privy.ready, privy.authPayload);
  return null;
}

function useGameRuntime(ready: boolean, auth: ClientAuthPayload): void {
  const runtimeRef = useRef<GameRuntime | undefined>(undefined);

  useEffect(() => {
    if (!ready || runtimeRef.current) return;
    let cancelled = false;
    void import('../src/main.ts').then(async ({startGameRuntime}) => {
      if (cancelled) return;
      const runtime = await startGameRuntime({
        serverUrl: resolveGameServerUrl(),
        renderer: new URLSearchParams(window.location.search).get('renderer') ?? undefined,
        auth
      });
      if (cancelled) {
        runtime.destroy();
        return;
      }
      runtimeRef.current = runtime;
    }).catch((error) => {
      console.error(error);
    });

    return () => {
      cancelled = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = undefined;
    };
  }, [ready]);
}

function resolveGameServerUrl(): string {
  if (process.env.NEXT_PUBLIC_GAME_SERVER_URL) return process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.hostname}:2567`;
}

'use client';

import {useEffect, useRef} from 'react';
import type {GameRuntime} from '../src/main.ts';
import {useNockPrivySession} from './useNockPrivySession';

export function GameRuntimeMount(): null {
  const privy = useNockPrivySession();
  const runtimeRef = useRef<GameRuntime | undefined>(undefined);
  const startingRef = useRef(false);

  useEffect(() => {
    if (!privy.ready || runtimeRef.current || startingRef.current) return;
    let cancelled = false;
    startingRef.current = true;
    void import('../src/main.ts').then(async ({startGameRuntime}) => {
      if (cancelled) return;
      const runtime = await startGameRuntime({
        serverUrl: resolveGameServerUrl(),
        renderer: new URLSearchParams(window.location.search).get('renderer') ?? undefined,
        auth: privy.authPayload
      });
      if (cancelled) {
        runtime.destroy();
        return;
      }
      runtimeRef.current = runtime;
    }).catch((error) => {
      console.error(error);
    }).finally(() => {
      startingRef.current = false;
    });

    return () => {
      cancelled = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = undefined;
    };
  }, [privy.ready]);

  return null;
}

function resolveGameServerUrl(): string {
  if (process.env.NEXT_PUBLIC_GAME_SERVER_URL) return process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.hostname}:2567`;
}

'use client';

import {useEffect, useRef} from 'react';
import type {GameRuntime} from '../src/main.ts';

export function GameRuntimeMount(): null {
  const runtimeRef = useRef<GameRuntime | undefined>(undefined);
  const startingRef = useRef(false);

  useEffect(() => {
    if (runtimeRef.current || startingRef.current) return;
    let cancelled = false;
    startingRef.current = true;
    void import('../src/main.ts').then(async ({startGameRuntime}) => {
      if (cancelled) return;
      const runtime = await startGameRuntime({
        serverUrl: resolveGameServerUrl(),
        auth: {provider: 'guest'}
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
  }, []);

  return null;
}

function resolveGameServerUrl(): string {
  if (process.env.NEXT_PUBLIC_GAME_SERVER_URL) return process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = process.env.NODE_ENV === 'production'
    ? window.location.host
    : `${window.location.hostname}:2567`;
  return `${protocol}://${host}`;
}

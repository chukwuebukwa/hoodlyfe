'use client';

import {useEffect, useRef} from 'react';
import type {GameRuntime} from '../src/main.ts';

export function GameRuntimeMount(): null {
  const runtimeRef = useRef<GameRuntime | undefined>(undefined);

  useEffect(() => {
    if (runtimeRef.current) return;
    let cancelled = false;
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
  return `${protocol}://${window.location.hostname}:2567`;
}

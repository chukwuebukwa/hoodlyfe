'use client';

import {useEffect, useRef} from 'react';
import type {GameRuntime} from '../src/main.ts';

interface GameRuntimeMountProps {
  roomName?: string;
  roomOptions?: Record<string, string>;
}

export function GameRuntimeMount({roomName, roomOptions}: GameRuntimeMountProps = {}): null {
  const runtimeRef = useRef<GameRuntime | undefined>(undefined);

  useEffect(() => {
    if (runtimeRef.current) return;
    let cancelled = false;
    void import('../src/main.ts').then(async ({startGameRuntime}) => {
      if (cancelled) return;
      const runtime = await startGameRuntime({
        serverUrl: resolveGameServerUrl(),
        auth: {provider: 'guest'},
        roomName,
        roomOptions
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
  }, [roomName, roomOptions]);

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

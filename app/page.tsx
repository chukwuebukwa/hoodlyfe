import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../components/GameRuntimeMount';
import {GameShell} from '../components/GameShell';

export default function HomePage(): ReactElement {
  return (
    <>
      <GameShell />
      <GameRuntimeMount />
    </>
  );
}

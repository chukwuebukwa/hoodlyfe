import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../components/GameRuntimeMount';
import {GameShell} from '../components/GameShell';
import {PhoneRuntimeMount} from '../components/PhoneRuntimeMount';

export default function HomePage(): ReactElement {
  return (
    <>
      <GameShell />
      <PhoneRuntimeMount />
      <GameRuntimeMount />
    </>
  );
}

import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../../components/GameRuntimeMount';
import {GameShell} from '../../components/GameShell';
import {PhoneRuntimeMount} from '../../components/PhoneRuntimeMount';

export default function DeathmatchPage(): ReactElement {
  return (
    <>
      <GameShell />
      <PhoneRuntimeMount />
      <GameRuntimeMount
        roomName="district-deathmatch"
        assetRoot="/assets/districts/deathmatch"
        runtimeLabel="FOUNDRY YARD"
        enableInteriors={false}
      />
    </>
  );
}

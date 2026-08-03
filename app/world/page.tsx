import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../../components/GameRuntimeMount';
import {GameShell} from '../../components/GameShell';
import {PhoneRuntimeMount} from '../../components/PhoneRuntimeMount';

export default function WorldPage(): ReactElement {
  return (
    <>
      <GameShell />
      <PhoneRuntimeMount />
      <GameRuntimeMount
        roomName="district-world"
        assetRoot="/assets/districts/world"
        runtimeLabel="GREATER NOCK0"
        enableInteriors={false}
      />
    </>
  );
}

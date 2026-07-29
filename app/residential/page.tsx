import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../../components/GameRuntimeMount';
import {GameShell} from '../../components/GameShell';
import {PhoneRuntimeMount} from '../../components/PhoneRuntimeMount';

export default function ResidentialPage(): ReactElement {
  return (
    <>
      <GameShell />
      <PhoneRuntimeMount />
      <GameRuntimeMount
        roomName="district-residential"
        assetRoot="/assets/districts/ste"
        runtimeLabel="RESIDENTIAL DISTRICT"
        enableInteriors={false}
      />
    </>
  );
}

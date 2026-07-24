import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../../components/GameRuntimeMount';
import {GameShell} from '../../components/GameShell';
import {PhoneRuntimeMount} from '../../components/PhoneRuntimeMount';

export default function RacePage(): ReactElement {
  return (
    <>
      <GameShell />
      <PhoneRuntimeMount />
      <GameRuntimeMount
        roomName="district-race"
        assetRoot="/assets/districts/raceway"
        runtimeLabel="RACEWAY"
        enableInteriors={false}
      />
    </>
  );
}

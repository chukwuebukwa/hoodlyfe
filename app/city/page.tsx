import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../../components/GameRuntimeMount';
import {GameShell} from '../../components/GameShell';
import {PhoneRuntimeMount} from '../../components/PhoneRuntimeMount';

export default function CityPage(): ReactElement {
  return (
    <>
      <GameShell />
      <PhoneRuntimeMount />
      <GameRuntimeMount
        roomName="district-city"
        assetRoot="/assets/districts/wil"
        runtimeLabel="DOWNTOWN DISTRICT"
        enableInteriors={false}
      />
    </>
  );
}

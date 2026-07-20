import type {ReactElement} from 'react';
import {GameRuntimeMount} from '../../components/GameRuntimeMount';
import {GameShell} from '../../components/GameShell';
import {PhoneRuntimeMount} from '../../components/PhoneRuntimeMount';

interface PlaytestPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlaytestPage({searchParams}: PlaytestPageProps): Promise<ReactElement> {
  const query = await searchParams;
  const assetSourceId = first(query.district);
  const revisionId = first(query.revision);
  const playtestToken = first(query.token);
  const laneFallback = first(query.laneFallback) === '1';
  if (!assetSourceId || !revisionId || !playtestToken) {
    return (
      <main className="playtest-error">
        <strong>PLAY DRAFT LINK IS INCOMPLETE</strong>
        <a href="/editor">Return to level editor</a>
      </main>
    );
  }
  const roomOptions = {assetSourceId, revisionId, playtestToken};
  return (
    <>
      <GameShell />
      <aside className="playtest-banner">
        <strong>PLAY DRAFT</strong>
        <span>{laneFallback ? 'REPOSITORY TRAFFIC LANES' : `${assetSourceId.toUpperCase()} / ${revisionId.slice(0, 8)}`}</span>
        <a href={`/editor?district=${encodeURIComponent(assetSourceId)}`}>EDITOR</a>
      </aside>
      <PhoneRuntimeMount />
      <GameRuntimeMount roomName="district-playtest" roomOptions={roomOptions} />
    </>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

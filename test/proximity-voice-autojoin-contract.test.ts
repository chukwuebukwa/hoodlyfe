import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../src/game/audio/proximity-voice-system.ts', import.meta.url);

test('proximity voice auto-joins receive-only without requesting microphone access', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const constructor = source.slice(
    source.indexOf('constructor('),
    source.indexOf('\n  synchronize(', source.indexOf('constructor('))
  );
  const synchronize = source.slice(
    source.indexOf('synchronize('),
    source.indexOf('\n  playerVoiceActivity(', source.indexOf('synchronize('))
  );
  const connect = source.slice(
    source.indexOf('private async connect('),
    source.indexOf('\n  private setPeers(', source.indexOf('private async connect('))
  );

  assert.doesNotMatch(constructor, /this\.enable\(\)/);
  assert.match(synchronize, /local && !this\.autoJoinAttempted/);
  assert.match(synchronize, /void this\.enable\(\)\.catch/);
  assert.doesNotMatch(connect, /setMicrophoneEnabled/);
});

test('microphone permission stays behind an explicit user action', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const prepare = source.slice(
    source.indexOf('private async prepareMicrophone('),
    source.indexOf('\n  private readonly handleTrackSubscribed', source.indexOf('private async prepareMicrophone('))
  );
  const toggle = source.slice(
    source.indexOf('private readonly handleToggle'),
    source.indexOf('\n  private readonly handleKeyDown', source.indexOf('private readonly handleToggle'))
  );

  assert.match(prepare, /setMicrophoneEnabled\(true/);
  assert.match(toggle, /this\.prepareMicrophone\(\)/);
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const SHELL_FILES = ['components/GameShell.tsx', 'index.html'] as const;
const REQUIRED_MARKUP = [
  'id="debug-interaction-island"',
  'id="debug-interaction-replay"',
  'id="debug-interaction-selection"',
  'id="debug-netcode-rollout"',
  'class="island-root"',
  'class="island-contact"',
  'class="island-retained"',
  'class="island-imminent"',
  'class="island-hysteresis"',
  'class="island-closure"',
  'class="island-overflow"',
  'class="island-presented"'
] as const;

test('browser entry points expose the complete interaction-island debug contract', () => {
  for (const path of SHELL_FILES) {
    const source = readFileSync(path, 'utf8');
    for (const markup of REQUIRED_MARKUP) {
      assert.ok(source.includes(markup), `${path} is missing ${markup}`);
    }
  }
});

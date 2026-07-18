import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const SHELL_FILES = ['components/GameShell.tsx', 'index.html'] as const;
const REQUIRED_MARKUP = [
  'id="debug-police-response"',
  'id="debug-police-arrests"',
  'id="debug-junctions"',
  'id="debug-roads"',
  'id="debug-traffic-risk"',
  'id="debug-interaction-island"',
  'id="debug-interaction-replay"',
  'id="debug-interaction-selection"',
  'id="debug-simulation-phases"',
  'id="debug-netcode-rollout"',
  'class="traffic-deadlock"',
  'class="traffic-recovery"',
  'class="island-root"',
  'class="island-contact"',
  'class="island-retained"',
  'class="island-imminent"',
  'class="island-hysteresis"',
  'class="island-closure"',
  'class="island-overflow"',
  'class="island-presented"'
] as const;
const REQUIRED_WIDE_ROWS = [
  'Police response',
  'Road graph',
  'Traffic risk',
  'Netcode rollout',
  'Island budget',
  'Island replay',
  'Island selection',
  'Server phases'
] as const;

test('browser entry points expose the complete systemic and netcode debug contract', () => {
  for (const path of SHELL_FILES) {
    const source = readFileSync(path, 'utf8');
    for (const markup of REQUIRED_MARKUP) {
      assert.ok(source.includes(markup), `${path} is missing ${markup}`);
    }
    for (const label of REQUIRED_WIDE_ROWS) {
      assert.ok(
        source.includes(`<div class="debug-wide"><dt>${label}</dt>`),
        `${path} does not span the ${label} debug row.`
      );
    }
  }
});

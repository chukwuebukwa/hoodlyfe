/**
 * Pinned golden-scenario hashes. Any change to contact/solver behavior fails
 * here instead of silently changing crash feel. If a change is INTENTIONAL
 * (tuning approved via the visual harness), regenerate the fixture:
 *
 *   UPDATE_GOLDEN=1 npx tsx --test test/engine/golden-scenarios.test.ts
 *
 * and review the diff of the fixture file alongside the code change.
 */

import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {SCENARIOS, createEngineScenarioRun} from '../../engine/testing/scenarios';
import {hashWorldState} from '../../engine/world/snapshot';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/golden-scenario-hashes.json', import.meta.url));
const SAMPLE_EVERY = 30;

type Fixture = Record<string, {ticks: number; hashes: Record<string, number>}>;

function runScenario(name: string): {ticks: number; hashes: Record<string, number>} {
  const scenario = SCENARIOS.find((s) => s.name === name)!;
  const run = createEngineScenarioRun(scenario);
  const hashes: Record<string, number> = {};
  for (let tick = 1; tick <= scenario.ticks; tick++) {
    run.step();
    if (tick % SAMPLE_EVERY === 0 || tick === scenario.ticks) {
      hashes[String(tick)] = hashWorldState(run.state);
    }
  }
  return {ticks: scenario.ticks, hashes};
}

if (process.env.UPDATE_GOLDEN) {
  test('regenerate golden fixture', () => {
    const fixture: Fixture = {};
    for (const scenario of SCENARIOS) fixture[scenario.name] = runScenario(scenario.name);
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  });
} else {
  const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

  test('fixture covers exactly the current scenario set', () => {
    assert.deepEqual(Object.keys(fixture).sort(), SCENARIOS.map((s) => s.name).sort());
  });

  for (const scenario of SCENARIOS) {
    test(`golden scenario: ${scenario.name}`, () => {
      const pinned = fixture[scenario.name];
      assert.ok(pinned, `no pinned hashes for ${scenario.name} — run with UPDATE_GOLDEN=1`);
      const actual = runScenario(scenario.name);
      assert.equal(actual.ticks, pinned.ticks);
      for (const [tick, hash] of Object.entries(pinned.hashes)) {
        assert.equal(
          actual.hashes[tick], hash,
          `${scenario.name} diverged at tick ${tick} — crash behavior changed; ` +
          'if intentional, re-approve in the harness and regenerate with UPDATE_GOLDEN=1'
        );
      }
    });
  }
}

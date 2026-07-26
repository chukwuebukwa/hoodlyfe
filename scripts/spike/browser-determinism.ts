// Browser-leg determinism validation (stage-2 gate of the physics migration; the
// behavior contract is unchanged through the engine migration): the same trace must
// be bit-identical between Node and Chromium because both run the same simulation code.
// Run: npx tsx scripts/spike/browser-determinism.ts

import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {initializePhysicsEngine} from '../../engine/adapters/surface-physics.ts';
import {
  geometryFromTiledMap,
  runDeterminismTrace,
  type DeterminismTraceResult,
  type TiledMapLike
} from './determinism-trace.ts';

function chromiumExecutable(): string {
  const override = process.env.CHROMIUM_PATH;
  if (override) return override;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const builds = readdirSync(cache)
    .filter((name) => name.startsWith('chromium_headless_shell-') || name.startsWith('chromium-'))
    .sort((left, right) => buildNumber(right) - buildNumber(left));
  for (const build of builds) {
    const candidates = [
      join(cache, build, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      join(
        cache, build, 'chrome-mac-arm64', 'Google Chrome for Testing.app',
        'Contents', 'MacOS', 'Google Chrome for Testing'
      )
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('No cached Chromium found; set CHROMIUM_PATH.');
}

function buildNumber(name: string): number {
  return Number(name.split('-').at(-1)) || 0;
}

async function main(): Promise<void> {
  const map = JSON.parse(
    readFileSync('public/assets/maps/district-map.json', 'utf8')
  ) as TiledMapLike;
  const geometry = geometryFromTiledMap(map);
  await initializePhysicsEngine();
  const nodeResult = runDeterminismTrace(geometry);
  report('node', nodeResult);

  const vite = await createServer({server: {port: 4199, strictPort: false}, logLevel: 'silent'});
  await vite.listen();
  const baseUrl = vite.resolvedUrls?.local[0] ?? 'http://localhost:4199/';
  const browser = await chromium.launch({executablePath: chromiumExecutable(), headless: true});
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('[page]', message.text());
    });
    await page.goto(`${baseUrl}scripts/spike/browser/`);
    await page.waitForFunction(() => Boolean((window as never as {__determinism?: unknown}).__determinism), undefined, {timeout: 120_000});
    const browserResult = await page.evaluate(
      () => (window as never as {__determinism: DeterminismTraceResult | {error: string}}).__determinism
    );
    if ('error' in browserResult) throw new Error(`browser leg failed: ${browserResult.error}`);
    report('browser', browserResult);

    const checks = [
      ['cross-platform trace bit-identical', browserResult.trace === nodeResult.trace],
      ['browser run-to-run bit-identical', browserResult.trace === browserResult.rerun],
      ['node run-to-run bit-identical', nodeResult.trace === nodeResult.rerun],
      [
        `browser writeback replay within budget (max ${browserResult.replayDivergence.toExponential(2)}px)`,
        browserResult.replayDivergence < 1e-3
      ]
    ] as const;
    let failed = false;
    console.log('');
    for (const [label, passed] of checks) {
      console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
      failed ||= !passed;
    }
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
    await vite.close();
  }
}

function report(leg: string, result: DeterminismTraceResult): void {
  console.log(
    `${leg.padEnd(7)} bodies=${result.bodyCount} trace=${result.trace.slice(0, 24)}… ` +
    `rerunMatch=${result.trace === result.rerun} ` +
    `replayBitIdentical=${result.replayBitIdentical} ` +
    `replayDivergence=${result.replayDivergence.toExponential(2)}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

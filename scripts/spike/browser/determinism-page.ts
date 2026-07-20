import {initializePhysicsEngine} from '../../../shared/physics/physics-world.ts';
import {
  geometryFromTiledMap,
  runDeterminismTrace,
  type TiledMapLike
} from '../determinism-trace.ts';

declare global {
  interface Window {
    __determinism?: unknown;
  }
}

async function main(): Promise<void> {
  const map = (await (await fetch('/assets/maps/district-map.json')).json()) as TiledMapLike;
  await initializePhysicsEngine();
  const result = runDeterminismTrace(geometryFromTiledMap(map));
  window.__determinism = result;
  document.getElementById('out')!.textContent =
    `bodies=${result.bodyCount} replayBitIdentical=${result.replayBitIdentical} ` +
    `trace=${result.trace.slice(0, 32)}…`;
}

main().catch((error) => {
  window.__determinism = {error: String(error?.stack ?? error)};
  document.getElementById('out')!.textContent = String(error);
});

import {Client, type Room} from 'colyseus.js';
import type {DistrictNetworkState} from './game/types.ts';
import {
  loadOnboardingIdentity,
  runOnboardingOverlay,
  shouldShowOnboarding
} from './game/onboarding/onboarding-flow.ts';
import {mountPrivyProfilePopup} from './game/auth/privy-profile-popup.ts';
import {PLAYER_SPAWN_MESSAGE} from '../shared/protocol/onboarding.ts';
import './style.css';

const serverProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ??
  (import.meta.env.DEV
    ? `${serverProtocol}://${window.location.hostname}:2567`
    : `${serverProtocol}://${window.location.host}`);
const onboarding = loadOnboardingIdentity();
const driverName = onboarding.driverName;
const playerAppearance = onboarding.appearance;
const playerAuth = onboarding.auth;
const onboardingRequired = shouldShowOnboarding();
const nameElement = document.querySelector('#driver-name');
let activeRoom: Room<DistrictNetworkState> | undefined;
let activeGame: {destroy(removeCanvas?: boolean): void} | undefined;
let activeThree: {start(): Promise<void>; destroy(): void} | undefined;
const profilePopup = mountPrivyProfilePopup();
if (nameElement) {
  nameElement.textContent = driverName;
}

try {
  const renderer = new URLSearchParams(window.location.search).get('renderer');
  if (renderer === 'three') {
    const shell = document.querySelector<HTMLElement>('#game-shell');
    const game = document.querySelector<HTMLElement>('#game');
    const loading = document.querySelector<HTMLElement>('#loading');
    if (!shell || !game) throw new Error('Three prototype mount is unavailable.');
    shell.dataset.renderer = 'three';
    if (loading) loading.innerHTML = '<strong>NOCK0 3D</strong><span>Loading GTA2 geometry</span>';
    const client = new Client(serverUrl);
    activeRoom = await client.joinOrCreate<DistrictNetworkState>('district', {
      name: driverName,
      appearance: playerAppearance,
      auth: playerAuth,
      spectator: onboardingRequired
    });
    const {ThreePrototypeViewer} = await import('./game/three/three-prototype-viewer.ts');
    activeThree = new ThreePrototypeViewer(game, activeRoom);
    await activeThree.start();
    loading?.classList.add('hidden');
  } else {
    const client = new Client(serverUrl);
    activeRoom = await client.joinOrCreate<DistrictNetworkState>('district', {
      name: driverName,
      appearance: playerAppearance,
      auth: playerAuth,
      spectator: onboardingRequired
    });
    const [{default: Phaser}, {DistrictScene}] = await Promise.all([
      import('phaser'),
      import('./game/district-scene.ts')
    ]);
    activeGame = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#080808',
      pixelArt: true,
      roundPixels: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: window.innerWidth,
        height: window.innerHeight
      },
      render: {
        antialias: false,
        pixelArt: true,
        roundPixels: true
      },
      scene: new DistrictScene(activeRoom)
    });
  }
  showOnboardingAfterStart();
} catch (error) {
  disposeRuntime();
  const loading = document.querySelector('#loading');
  if (loading) {
    loading.innerHTML = '<strong>NOCK0</strong><span>District server unavailable</span>';
  }
  document.querySelector('#connection-state')?.classList.add('offline');
  console.error(error);
}

function showOnboardingAfterStart(): void {
  if (!activeRoom || !onboardingRequired) return;
  void runOnboardingOverlay(driverName, playerAppearance).then((result) => {
    if (nameElement) nameElement.textContent = result.driverName;
    activeRoom?.send(PLAYER_SPAWN_MESSAGE, {
      name: result.driverName,
      appearance: result.appearance,
      auth: result.auth
    });
  }).catch((error) => {
    console.error(error);
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeRuntime);
}

function disposeRuntime(): void {
  activeGame?.destroy(true);
  activeGame = undefined;
  activeThree?.destroy();
  activeThree = undefined;
  void activeRoom?.leave(true);
  activeRoom = undefined;
  profilePopup.destroy();
}

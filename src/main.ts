import {Client, type Room} from 'colyseus.js';
import Phaser from 'phaser';
import {DistrictScene} from './game/district-scene.ts';
import type {DistrictNetworkState} from './game/types.ts';
import './style.css';

const serverProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ?? `${serverProtocol}://${window.location.hostname}:2567`;
const driverName = getDriverName();
const nameElement = document.querySelector('#driver-name');
let activeRoom: Room<DistrictNetworkState> | undefined;
let activeGame: Phaser.Game | undefined;
if (nameElement) {
  nameElement.textContent = driverName;
}

try {
  const client = new Client(serverUrl);
  activeRoom = await client.joinOrCreate<DistrictNetworkState>('district', {name: driverName});
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
} catch (error) {
  disposeRuntime();
  const loading = document.querySelector('#loading');
  if (loading) {
    loading.innerHTML = '<strong>NOCK0</strong><span>District server unavailable</span>';
  }
  document.querySelector('#connection-state')?.classList.add('offline');
  console.error(error);
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeRuntime);
}

function disposeRuntime(): void {
  activeGame?.destroy(true);
  activeGame = undefined;
  void activeRoom?.leave(true);
  activeRoom = undefined;
}

function getDriverName(): string {
  const saved = window.localStorage.getItem('nock0-driver-name');
  if (saved) {
    return saved;
  }
  const generated = `Driver-${Math.floor(1000 + Math.random() * 9000)}`;
  window.localStorage.setItem('nock0-driver-name', generated);
  return generated;
}

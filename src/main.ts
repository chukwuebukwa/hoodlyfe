import {Client, type Room} from 'colyseus.js';
import type {PlayerAppearance} from '../shared/content/appearance-catalog.ts';
import type {ClientAuthPayload} from '../shared/protocol/auth.ts';
import {PLAYER_SPAWN_MESSAGE} from '../shared/protocol/onboarding.ts';
import {
  loadOnboardingIdentity,
  runOnboardingOverlay,
  shouldShowOnboarding
} from './game/onboarding/onboarding-flow.ts';
import type {DistrictNetworkState} from './game/types.ts';
import {NetcodeRolloutController} from './game/network/netcode-rollout-controller.ts';
import {NockPhoneController} from './game/ui/nock-phone-controller.ts';

export interface StartGameRuntimeOptions {
  serverUrl: string;
  auth?: ClientAuthPayload;
}

export interface GameRuntime {
  destroy(): void;
}

export async function startGameRuntime(options: StartGameRuntimeOptions): Promise<GameRuntime> {
  const runtime = new GameRuntimeController(options);
  await runtime.start();
  return runtime;
}

class GameRuntimeController implements GameRuntime {
  private activeRoom: Room<DistrictNetworkState> | undefined;
  private activeThree: {start(): Promise<void>; destroy(): void} | undefined;
  private loadingUi: LoadingController | undefined;
  private netcodeRollout: NetcodeRolloutController | undefined;
  private readonly phone = NockPhoneController.forDocument();

  constructor(private readonly options: StartGameRuntimeOptions) {}

  async start(): Promise<void> {
    const onboarding = loadOnboardingIdentity();
    const driverName = onboarding.driverName;
    const playerAppearance = onboarding.appearance;
    const playerAuth = this.options.auth ?? onboarding.auth;
    const onboardingRequired = shouldShowOnboarding();
    const nameElement = document.querySelector('#driver-name');
    this.loadingUi = createLoadingController();
    if (nameElement) nameElement.textContent = driverName;

    try {
      this.loadingUi.set(0.06, 'Selecting street renderer');
      await this.startThree(driverName, playerAppearance, playerAuth, onboardingRequired);
      this.showOnboardingAfterStart(driverName, playerAppearance, playerAuth, onboardingRequired);
    } catch (error) {
      const loadingUi = this.loadingUi;
      this.destroy();
      const loading = document.querySelector('#loading');
      if (loading) {
        loading.classList.remove('hidden');
        loadingUi?.setTitle('NOCK0');
        loadingUi?.set(1, 'District server unavailable');
      }
      document.querySelector('#connection-state')?.classList.add('offline');
      console.error(error);
      throw error;
    }
  }

  destroy(): void {
    this.activeThree?.destroy();
    this.activeThree = undefined;
    this.netcodeRollout?.destroy();
    this.netcodeRollout = undefined;
    void this.activeRoom?.leave(true);
    this.activeRoom = undefined;
    this.loadingUi?.destroy();
    this.loadingUi = undefined;
  }

  private async startThree(
    driverName: string,
    playerAppearance: PlayerAppearance,
    playerAuth: ClientAuthPayload,
    onboardingRequired: boolean
  ): Promise<void> {
    const shell = document.querySelector<HTMLElement>('#game-shell');
    const game = document.querySelector<HTMLElement>('#game');
    if (!shell || !game) throw new Error('Three prototype mount is unavailable.');
    shell.dataset.renderer = 'three';
    this.loadingUi?.setTitle('NOCK0');
    this.loadingUi?.set(0.14, 'Connecting district server');
    const client = new Client(this.options.serverUrl);
    this.activeRoom = await client.joinOrCreate<DistrictNetworkState>('district', {
      name: driverName,
      appearance: playerAppearance,
      auth: playerAuth,
      spectator: onboardingRequired
    });
    this.startNetworkControllers(this.activeRoom);
    this.loadingUi?.set(0.42, 'District room joined');
    this.loadingUi?.set(0.56, 'Loading GTA2 geometry');
    const {ThreePrototypeViewer} = await import('./game/three/three-prototype-viewer.ts');
    this.loadingUi?.set(0.72, 'Building roads and rooftops');
    this.activeThree = new ThreePrototypeViewer(
      game,
      this.activeRoom,
      this.netcodeRollout,
      this.phone
    );
    await this.activeThree.start();
    this.loadingUi?.set(0.95, 'Preparing driver');
    this.loadingUi?.finish();
  }

  private showOnboardingAfterStart(
    driverName: string,
    playerAppearance: PlayerAppearance,
    playerAuth: ClientAuthPayload,
    onboardingRequired: boolean
  ): void {
    if (!this.activeRoom || !onboardingRequired) return;
    void runOnboardingOverlay(driverName, playerAppearance, playerAuth).then((result) => {
      const nameElement = document.querySelector('#driver-name');
      if (nameElement) nameElement.textContent = result.driverName;
      this.activeRoom?.send(PLAYER_SPAWN_MESSAGE, {
        name: result.driverName,
        appearance: result.appearance,
        auth: result.auth
      });
    }).catch((error) => {
      console.error(error);
    });
  }

  private startNetworkControllers(room: Room<DistrictNetworkState>): void {
    this.netcodeRollout?.destroy();
    this.netcodeRollout = new NetcodeRolloutController(room);
  }
}

interface LoadingController {
  setTitle(title: string): void;
  set(progress: number, stage: string): void;
  finish(): void;
  destroy(): void;
}

function createLoadingController(): LoadingController {
  const root = document.querySelector<HTMLElement>('#loading');
  const title = document.querySelector<HTMLElement>('#loading-title');
  const stage = document.querySelector<HTMLElement>('#loading-stage');
  const fill = document.querySelector<HTMLElement>('#loading-progress-fill');
  const percent = document.querySelector<HTMLElement>('#loading-percent');
  const tip = document.querySelector<HTMLElement>('#loading-tip');
  const tips = [
    'Tip: stay off the sidewalk when the heat meter starts climbing.',
    'Tip: enter vehicles from close range to avoid getting boxed in.',
    'Tip: the phone is your account, wallet, and job hub.',
    'Tip: CASHCAT metadata loads from Dexscreener when available.'
  ];
  let current = 0;
  let tipIndex = 0;
  const tipTimer = window.setInterval(() => {
    if (!tip || root?.classList.contains('hidden')) return;
    tipIndex = (tipIndex + 1) % tips.length;
    tip.textContent = tips[tipIndex];
  }, 1700);

  const apply = (value: number, text: string): void => {
    current = Math.max(current, Math.min(1, value));
    if (stage) stage.textContent = text;
    if (fill) fill.style.width = `${Math.round(current * 100)}%`;
    if (percent) percent.textContent = `${Math.round(current * 100)}%`;
  };

  return {
    setTitle: (value) => {
      if (title) title.textContent = value;
    },
    set: apply,
    finish: () => {
      apply(1, 'Entering district');
      window.setTimeout(() => {
        root?.classList.add('hidden');
        window.clearInterval(tipTimer);
      }, 250);
    },
    destroy: () => {
      window.clearInterval(tipTimer);
    }
  };
}

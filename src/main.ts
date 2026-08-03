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
import {
  gameWorldDefinition,
  gameWorldIdForRoom,
  type GameWorldId
} from './game/runtime/world-catalog.ts';

export interface StartGameRuntimeOptions {
  serverUrl: string;
  auth?: ClientAuthPayload;
  roomName?: string;
  roomOptions?: Record<string, string>;
  assetRoot?: string;
  runtimeLabel?: string;
  enableInteriors?: boolean;
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
  private activeSession: WorldSession | undefined;
  private loadingUi: LoadingController | undefined;
  private readonly phone = NockPhoneController.forDocument();
  private driverName = 'Driver';
  private playerAppearance?: PlayerAppearance;
  private playerAuth?: ClientAuthPayload;
  private transition?: Promise<void>;
  private destroyed = false;

  constructor(private readonly options: StartGameRuntimeOptions) {}

  async start(): Promise<void> {
    this.phone.setAvailable(false);
    const onboarding = loadOnboardingIdentity();
    this.driverName = onboarding.driverName;
    this.playerAppearance = onboarding.appearance;
    this.playerAuth = this.options.auth ?? onboarding.auth;
    const onboardingRequired = shouldShowOnboarding();
    const nameElement = document.querySelector('#driver-name');
    const initialWorld = this.initialWorld();
    this.applyWorldLabel(initialWorld);
    this.loadingUi = createLoadingController();
    this.loadingUi.begin(initialWorld.loadingTitle, 'Selecting street renderer');
    if (nameElement) nameElement.textContent = this.driverName;

    try {
      this.loadingUi.set(0.06, 'Selecting street renderer');
      const room = await this.joinWorld(initialWorld, onboardingRequired);
      this.activeSession = await this.createWorldSession(initialWorld, room);
      this.configurePhone(false);
      this.loadingUi.set(0.95, 'Preparing driver');
      this.loadingUi.finish();
      if (!onboardingRequired) this.phone.setAvailable(true);
      this.showOnboardingAfterStart(onboardingRequired);
    } catch (error) {
      const loadingUi = this.loadingUi;
      this.destroy();
      const loading = document.querySelector('#loading');
      if (loading) {
        loading.classList.remove('hidden');
        loadingUi?.setTitle('HOODLYFE');
        loadingUi?.set(1, 'District failed to load');
      }
      document.querySelector('#connection-state')?.classList.add('offline');
      console.error(error);
      throw error;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.phone.setActivityContext(undefined);
    this.phone.setAvailable(false);
    this.activeSession?.districtClient.destroy();
    this.activeSession?.netcodeRollout.destroy();
    void this.activeSession?.room.leave(true);
    this.activeSession = undefined;
    this.loadingUi?.destroy();
    this.loadingUi = undefined;
  }

  private initialWorld(): RuntimeWorldDefinition {
    const id = gameWorldIdForRoom(this.options.roomName);
    const catalog = id ? gameWorldDefinition(id) : undefined;
    return {
      id,
      roomName: this.options.roomName ?? catalog?.roomName ?? 'district',
      roomOptions: this.options.roomOptions,
      assetRoot: this.options.assetRoot ?? catalog?.assetRoot ?? '/assets',
      runtimeLabel: this.options.runtimeLabel ?? catalog?.runtimeLabel ?? 'Industrial District',
      loadingTitle: catalog?.loadingTitle ?? 'HOODLYFE',
      enableInteriors: this.options.enableInteriors ?? catalog?.enableInteriors ?? true
    };
  }

  private async joinWorld(
    world: RuntimeWorldDefinition,
    spectator = false
  ): Promise<Room<DistrictNetworkState>> {
    if (!this.playerAppearance || !this.playerAuth) {
      throw new Error('Player identity is unavailable.');
    }
    this.loadingUi?.set(0.14, `Connecting ${world.runtimeLabel}`);
    const client = new Client(this.options.serverUrl);
    const room = await client.joinOrCreate<DistrictNetworkState>(world.roomName, {
      ...world.roomOptions,
      name: this.driverName,
      appearance: this.playerAppearance,
      auth: this.playerAuth,
      spectator
    });
    await waitForInitialState(room);
    return room;
  }

  private async createWorldSession(
    world: RuntimeWorldDefinition,
    room: Room<DistrictNetworkState>
  ): Promise<WorldSession> {
    const game = document.querySelector<HTMLElement>('#game');
    if (!game) throw new Error('Game mount is unavailable.');
    const netcodeRollout = new NetcodeRolloutController(room);
    let districtClient: DistrictClientRuntime | undefined;
    this.loadingUi?.set(0.42, `${world.runtimeLabel} room joined`);
    this.loadingUi?.set(0.56, `Loading ${world.runtimeLabel} geometry`);
    const {DistrictClient} = await import('./game/district-client.ts');
    this.loadingUi?.set(0.72, 'Building roads and rooftops');
    try {
      districtClient = new DistrictClient(
        game,
        room,
        netcodeRollout,
        this.phone,
        world.assetRoot,
        world.enableInteriors,
        (progress, label) => this.loadingUi?.set(progress, label)
      );
      await districtClient.start();
      return {world, room, districtClient, netcodeRollout};
    } catch (error) {
      districtClient?.destroy();
      netcodeRollout.destroy();
      throw error;
    }
  }

  private showOnboardingAfterStart(onboardingRequired: boolean): void {
    const session = this.activeSession;
    if (!session || !onboardingRequired || !this.playerAppearance || !this.playerAuth) return;
    void runOnboardingOverlay(this.driverName, this.playerAppearance, this.playerAuth).then((result) => {
      this.driverName = result.driverName;
      this.playerAppearance = result.appearance;
      this.playerAuth = result.auth;
      const nameElement = document.querySelector('#driver-name');
      if (nameElement) nameElement.textContent = result.driverName;
      session.room.send(PLAYER_SPAWN_MESSAGE, {
        name: result.driverName,
        appearance: result.appearance,
        auth: result.auth
      });
      this.phone.setAvailable(true);
    }).catch((error) => {
      console.error(error);
    });
  }

  private configurePhone(busy: boolean): void {
    const worldId = this.activeSession?.world.id;
    if (!worldId) {
      this.phone.setActivityContext(undefined);
      return;
    }
    this.phone.setActivityContext({
      busy,
      currentWorld: worldId,
      onTravel: (destination) => this.transitionTo(destination)
    });
  }

  private transitionTo(destination: GameWorldId): Promise<void> {
    if (this.activeSession?.world.id === destination) return Promise.resolve();
    if (this.transition) return this.transition;
    const transition = this.performTransition(destination);
    this.transition = transition.finally(() => {
      this.transition = undefined;
    });
    return this.transition;
  }

  private async performTransition(destination: GameWorldId): Promise<void> {
    const source = this.activeSession;
    if (!source || this.destroyed) return;
    const targetWorld = runtimeWorld(gameWorldDefinition(destination));
    const shell = document.querySelector<HTMLElement>('#game-shell');
    shell?.setAttribute('data-transitioning', 'true');
    this.configurePhone(true);
    this.loadingUi?.begin(targetWorld.loadingTitle, `Traveling to ${targetWorld.runtimeLabel}`);
    let targetRoom: Room<DistrictNetworkState> | undefined;
    let targetSession: WorldSession | undefined;
    let sourcePresentationDestroyed = false;
    try {
      targetRoom = await this.joinWorld(targetWorld);
      if (this.destroyed) {
        await targetRoom.leave(true);
        return;
      }
      this.loadingUi?.set(0.46, 'Destination reserved');
      source.districtClient.destroy();
      source.netcodeRollout.destroy();
      sourcePresentationDestroyed = true;
      targetSession = await this.createWorldSession(targetWorld, targetRoom);
      if (this.destroyed) {
        targetSession.districtClient.destroy();
        targetSession.netcodeRollout.destroy();
        await targetRoom.leave(true);
        return;
      }
      this.activeSession = targetSession;
      this.applyWorldLabel(targetWorld);
      this.configurePhone(false);
      this.loadingUi?.set(0.95, 'Destination ready');
      this.loadingUi?.finish(`Entering ${targetWorld.runtimeLabel}`);
      void source.room.leave(true).catch((error) => {
        console.error('Failed to close the previous district room.', error);
      });
    } catch (error) {
      targetSession?.districtClient.destroy();
      targetSession?.netcodeRollout.destroy();
      if (targetRoom && targetRoom !== targetSession?.room) {
        await targetRoom.leave(true).catch(() => undefined);
      } else {
        await targetSession?.room.leave(true).catch(() => undefined);
      }
      if (!this.destroyed && sourcePresentationDestroyed) {
        this.loadingUi?.set(0.58, 'Restoring previous district');
        try {
          this.activeSession = await this.createWorldSession(source.world, source.room);
        } catch (restoreError) {
          this.activeSession = undefined;
          await source.room.leave(true).catch(() => undefined);
          this.loadingUi?.set(1, 'District failed to load');
          console.error(restoreError);
          showRuntimeNotice('Travel failed and the previous district could not be restored.', 'warning');
          return;
        }
      } else if (!this.destroyed) {
        this.activeSession = source;
      }
      if (!this.destroyed) {
        this.applyWorldLabel(source.world);
        this.configurePhone(false);
        this.loadingUi?.finish('Travel unavailable');
        showRuntimeNotice('Travel unavailable. You remain in the current district.', 'warning');
      }
      console.error(error);
    } finally {
      shell?.setAttribute('data-transitioning', 'false');
    }
  }

  private applyWorldLabel(world: RuntimeWorldDefinition): void {
    const districtLabel = document.querySelector<HTMLElement>('#district-label span');
    if (districtLabel) districtLabel.textContent = world.runtimeLabel;
  }
}

interface DistrictClientRuntime {
  start(): Promise<void>;
  destroy(): void;
}

interface RuntimeWorldDefinition {
  id?: GameWorldId;
  roomName: string;
  roomOptions?: Record<string, string>;
  assetRoot: string;
  runtimeLabel: string;
  loadingTitle: string;
  enableInteriors: boolean;
}

interface WorldSession {
  world: RuntimeWorldDefinition;
  room: Room<DistrictNetworkState>;
  districtClient: DistrictClientRuntime;
  netcodeRollout: NetcodeRolloutController;
}

interface LoadingController {
  begin(title: string, stage: string): void;
  setTitle(title: string): void;
  set(progress: number, stage: string): void;
  finish(stage?: string): void;
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
  let hideTimer: number | undefined;
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
    begin: (titleText, stageText) => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      hideTimer = undefined;
      current = 0;
      root?.classList.remove('hidden');
      if (title) title.textContent = titleText;
      apply(0, stageText);
    },
    setTitle: (value) => {
      if (title) title.textContent = value;
    },
    set: apply,
    finish: (stageText = 'Entering district') => {
      apply(1, stageText);
      hideTimer = window.setTimeout(() => {
        root?.classList.add('hidden');
        hideTimer = undefined;
      }, 250);
    },
    destroy: () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      window.clearInterval(tipTimer);
    }
  };
}

function runtimeWorld(world: ReturnType<typeof gameWorldDefinition>): RuntimeWorldDefinition {
  return {...world};
}

async function waitForInitialState(room: Room<DistrictNetworkState>): Promise<void> {
  if (room.state?.players) return;
  await new Promise<void>((resolve, reject) => {
    const onState = (state: DistrictNetworkState) => {
      if (!state?.players) return;
      room.onStateChange.remove(onState);
      room.onLeave.remove(onLeave);
      resolve();
    };
    const onLeave = (code: number) => {
      room.onStateChange.remove(onState);
      room.onLeave.remove(onLeave);
      reject(new Error(`District room closed before initial state (${code}).`));
    };
    room.onStateChange(onState);
    room.onLeave(onLeave);
  });
}

function showRuntimeNotice(message: string, tone: 'info' | 'warning'): void {
  const toast = document.querySelector<HTMLElement>('#event-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 2_400);
}

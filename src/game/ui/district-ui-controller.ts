import type {Room} from 'colyseus.js';
import {
  DEFAULT_MISSION_TEMPLATE_ID,
  cycleMissionTemplate,
  type MissionTemplateId
} from '../../../shared/content/mission-catalog.ts';
import {
  MISSION_ABANDON_MESSAGE,
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_START_MESSAGE
} from '../../../shared/protocol/missions.ts';
import {GAME_NOTICE_MESSAGE, type GameNotice} from '../../../shared/protocol/notices.ts';
import {
  serviceMinimapPoints,
  storefrontMinimapPoints,
  type InteractionAnchor
} from '../interactions/interaction-presentation-policy.ts';
import {projectContextPrompt} from '../interactions/context-prompt-policy.ts';
import {MedicalCarePresentationController} from '../medical/medical-care-presentation-controller.ts';
import {buildMinimapFrame} from '../minimap-marker-policy.ts';
import {MinimapRenderer} from '../minimap-renderer.ts';
import {
  missionMinimapPoints,
  projectMissionHud
} from '../missions/mission-presentation-policy.ts';
import {weaponPickupMinimapPoints} from '../rendering/weapon-pickup-render-policy.ts';
import {cashPickupMinimapPoints} from '../rendering/cash-pickup-render-policy.ts';
import type {DistrictNetworkState} from '../types.ts';
import {RadioSystem} from '../audio/radio-system.ts';
import {SfxSystem} from '../audio/sfx-system.ts';
import {VehicleAudioSystem} from '../audio/vehicle-audio-system.ts';
import {ProximityVoiceSystem} from '../audio/proximity-voice-system.ts';
import {LocalHudController} from './local-hud-controller.ts';
import {NockPhoneController} from './nock-phone-controller.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {AppearanceCreatorController} from '../appearance/appearance-creator-controller.ts';
import type {ActorRenderPose} from '../rendering/render-types.ts';

const UI_INTERVAL_MS = 100;

interface HudPoint {
  x: number;
  y: number;
  visible: boolean;
}

export class DistrictUiController {
  private readonly hud = new LocalHudController();
  private readonly radio: RadioSystem;
  private readonly sfx: SfxSystem;
  private readonly vehicleAudio: VehicleAudioSystem;
  private readonly voice: ProximityVoiceSystem;
  private readonly medical: MedicalCarePresentationController;
  private readonly appearance: AppearanceCreatorController;
  private readonly phone: NockPhoneController;
  private readonly ownsPhone: boolean;
  private readonly minimap?: MinimapRenderer;
  private readonly missionHud = document.querySelector<HTMLElement>('#mission-hud');
  private readonly missionTitle = document.querySelector('#mission-title');
  private readonly missionTimer = document.querySelector('#mission-timer');
  private readonly missionObjective = document.querySelector('#mission-objective');
  private readonly missionMeta = document.querySelector('#mission-meta');
  private readonly missionAction = document.querySelector<HTMLButtonElement>('#mission-action');
  private readonly missionPrevious = document.querySelector<HTMLButtonElement>('#mission-prev');
  private readonly missionNext = document.querySelector<HTMLButtonElement>('#mission-next');
  private readonly interactionButton = document.querySelector<HTMLButtonElement>('#vehicle-action-button');
  private readonly handbrakeHint = document.querySelector<HTMLElement>('#vehicle-handbrake-hint');
  private readonly touchInteractionButton = document.querySelector<HTMLButtonElement>('#interact-button');
  private interactionAnchor?: InteractionAnchor;
  private selectedTemplate: MissionTemplateId = DEFAULT_MISSION_TEMPLATE_ID;
  private lastUpdateAt = Number.NEGATIVE_INFINITY;
  private readonly removeNotice: () => void;

  constructor(
    private readonly room: Room<DistrictNetworkState>,
    worldWidth: number,
    worldHeight: number,
    private readonly localPose: () => ActorRenderPose | undefined = () => undefined,
    phone?: NockPhoneController,
    assetRoot = '/assets',
    private readonly projectWorldPoint: (
      x: number,
      y: number,
      height: number
    ) => HudPoint | undefined = () => undefined
  ) {
    this.phone = phone ?? new NockPhoneController();
    this.ownsPhone = !phone;
    this.radio = new RadioSystem(document, room);
    this.sfx = new SfxSystem(room);
    this.vehicleAudio = new VehicleAudioSystem();
    this.voice = new ProximityVoiceSystem(room);
    this.medical = new MedicalCarePresentationController(room);
    this.appearance = new AppearanceCreatorController(room, room.sessionId);
    const canvas = document.querySelector<HTMLCanvasElement>('#minimap-canvas');
    if (canvas) {
      this.minimap = new MinimapRenderer(
        canvas,
        `${assetRoot}/maps/district-preview.png`,
        worldWidth,
        worldHeight
      );
    }
    this.missionAction?.addEventListener('click', this.handleMissionAction);
    this.missionPrevious?.addEventListener('click', this.handlePreviousMission);
    this.missionNext?.addEventListener('click', this.handleNextMission);
    this.removeNotice = room.onMessage<GameNotice>(GAME_NOTICE_MESSAGE, (notice) => {
      this.hud.show(notice.message, notice.tone);
    });
    room.onLeave(this.handleDisconnected);
    room.onError(this.handleDisconnected);
    this.hud.setConnection(true);
  }

  isInputBlocked(): boolean {
    return this.appearance.isOpen() || this.phone.isOpen();
  }

  playerVoiceActivity(playerId: string): number {
    return this.voice.playerVoiceActivity(playerId);
  }

  presentDryFire(): void {
    this.sfx.presentDryFire();
  }

  update(state: DistrictNetworkState, nowMs: number): void {
    this.positionInteraction(state);
    if (nowMs - this.lastUpdateAt < UI_INTERVAL_MS) return;
    this.lastUpdateAt = nowMs;
    const local = state.players.get(this.room.sessionId);
    const vehicle = local?.vehicleId ? state.vehicles.get(local.vehicleId) : undefined;
    const onStreet = !local || (local.spaceId || STREET_SPACE_ID) === STREET_SPACE_ID;
    if (local) this.hud.update(local, vehicle);
    this.radio.synchronize(local, vehicle);
    this.sfx.synchronize(local, vehicle);
    this.vehicleAudio.synchronize(local, vehicle, state.vehicles);
    this.voice.synchronize(state);
    document.querySelector('#minimap-hud')?.classList.toggle(
      'hidden',
      Boolean(local && local.spaceId !== STREET_SPACE_ID)
    );
    this.medical.synchronize(local);
    this.appearance.synchronize(state);
    this.phone.synchronize(state, this.room.sessionId);
    this.updateInteraction(state);
    if (onStreet) {
      if (state.deathmatch?.arenaId) this.updateDeathmatch(state);
      else if (state.race?.trackId) this.updateRace(state);
      else this.updateMission(state);
    } else {
      this.missionHud?.classList.add('hidden');
    }
    this.updateMinimap(state, nowMs);
    const shell = document.querySelector<HTMLElement>('#game-shell');
    if (shell) {
      shell.dataset.players = String(state.players?.size ?? 0);
      shell.dataset.npcs = String(state.npcs?.size ?? 0);
      shell.dataset.vehicles = String(state.vehicles?.size ?? 0);
      shell.dataset.driving = String(Boolean(local?.vehicleId && local.vehicleSeat === 0));
      shell.dataset.explosives = String(
        (state.thrownProjectiles?.size ?? 0) + (state.explosions?.size ?? 0)
      );
    }
  }

  destroy(): void {
    this.missionAction?.removeEventListener('click', this.handleMissionAction);
    this.missionPrevious?.removeEventListener('click', this.handlePreviousMission);
    this.missionNext?.removeEventListener('click', this.handleNextMission);
    this.removeNotice();
    this.room.onLeave.remove(this.handleDisconnected);
    this.room.onError.remove(this.handleDisconnected);
    this.medical.destroy();
    this.appearance.destroy();
    if (this.ownsPhone) this.phone.destroy();
    this.radio.destroy();
    this.sfx.destroy();
    this.vehicleAudio.destroy();
    this.voice.destroy();
    this.hud.destroy();
  }

  private updateInteraction(state: DistrictNetworkState): void {
    if (state.race?.trackId || state.deathmatch?.arenaId) {
      this.interactionButton?.classList.add('hidden');
      this.handbrakeHint?.classList.add('hidden');
      this.touchInteractionButton?.classList.add('hidden');
      this.interactionAnchor = undefined;
      return;
    }
    this.touchInteractionButton?.classList.remove('hidden');
    const prompt = projectContextPrompt(state, this.room.sessionId, this.selectedTemplate);
    this.interactionAnchor = prompt.anchor;
    this.interactionButton?.classList.toggle('hidden', !prompt.visible);
    this.handbrakeHint?.classList.toggle('hidden', prompt.placement !== 'driving');
    if (this.interactionButton && prompt.visible) {
      this.renderContextPrompt(this.interactionButton, 'F', prompt.label);
      this.interactionButton.setAttribute('aria-label', prompt.ariaLabel);
      this.interactionButton.dataset.placement = prompt.placement;
      this.interactionButton.dataset.command = prompt.command;
      this.interactionButton.dataset.templateId = prompt.templateId ?? '';
    }
    if (this.touchInteractionButton) {
      this.touchInteractionButton.textContent = prompt.touchLabel;
      this.touchInteractionButton.setAttribute(
        'aria-label',
        prompt.visible ? prompt.ariaLabel : 'Interact'
      );
    }
    this.positionInteraction(state);
  }

  private positionInteraction(state: DistrictNetworkState): void {
    const button = this.interactionButton;
    const anchor = this.interactionAnchor;
    if (!button || button.classList.contains('hidden') || !anchor) {
      button?.classList.remove('context-offscreen');
      return;
    }
    const vehicle = anchor.vehicleId ? state.vehicles.get(anchor.vehicleId) : undefined;
    const x = vehicle?.x ?? anchor.x;
    const y = vehicle?.y ?? anchor.y;
    const point = this.projectWorldPoint(x, y, anchor.vehicleId ? 96 : 72);
    button.classList.toggle('context-offscreen', !point?.visible);
    if (!point) return;
    button.style.left = `${point.x}px`;
    button.style.top = `${point.y}px`;
  }

  private renderContextPrompt(button: HTMLButtonElement, key: string, label: string): void {
    if (button.dataset.key === key && button.dataset.label === label) return;
    const keyCap = document.createElement('kbd');
    keyCap.textContent = key;
    const text = document.createElement('span');
    text.textContent = label;
    button.replaceChildren(keyCap, text);
    button.dataset.key = key;
    button.dataset.label = label;
  }

  private updateMission(state: DistrictNetworkState): void {
    const projection = projectMissionHud(state, this.room.sessionId, this.selectedTemplate);
    this.missionHud?.classList.toggle('hidden', !projection.visible);
    if (!projection.visible) return;
    if (this.missionTitle) this.missionTitle.textContent = projection.title;
    if (this.missionTimer) this.missionTimer.textContent = projection.timer;
    if (this.missionObjective) this.missionObjective.textContent = projection.objective;
    if (this.missionMeta) this.missionMeta.textContent = projection.meta;
    this.missionPrevious?.classList.toggle('hidden', !projection.templateSelectorVisible);
    this.missionNext?.classList.toggle('hidden', !projection.templateSelectorVisible);
    if (!this.missionAction) return;
    this.missionAction.dataset.action = projection.action;
    this.missionAction.dataset.missionId = projection.missionId;
    this.missionAction.textContent = projection.actionLabel;
    const contextOwnsMissionStart =
      projectContextPrompt(state, this.room.sessionId, this.selectedTemplate).command ===
        'mission-start';
    this.missionAction.classList.toggle(
      'hidden',
      !projection.action || (projection.action === 'start' && contextOwnsMissionStart)
    );
    this.missionAction.classList.toggle('warning', projection.actionWarning);
  }

  private updateRace(state: DistrictNetworkState): void {
    const race = state.race;
    const entrant = race?.entrants?.get(this.room.sessionId);
    this.missionHud?.classList.toggle('hidden', !race || !entrant);
    if (!race || !entrant) return;
    const serverNow = state.serverTimeMs ?? 0;
    const countdown = Math.max(0, Math.ceil((race.countdownEndsAt - serverNow) / 1_000));
    if (this.missionTitle) this.missionTitle.textContent = race.trackLabel.toUpperCase();
    if (this.missionTimer) {
      this.missionTimer.textContent = race.phase === 'countdown'
        ? String(countdown)
        : formatRaceTime(
          entrant.finished ? entrant.finishTimeMs : Math.max(0, serverNow - race.startedAt)
        );
    }
    if (this.missionObjective) {
      this.missionObjective.textContent = race.phase === 'countdown'
        ? 'Hold the grid. Get ready.'
        : race.phase === 'results'
          ? entrant.finished
            ? `Finished P${entrant.position}.`
            : 'Heat complete.'
          : `Lap ${Math.max(1, entrant.lap)}/${race.lapsRequired} | ` +
            `Checkpoint ${entrant.checkpointIndex + 1}`;
    }
    if (this.missionMeta) {
      this.missionMeta.textContent = `P${Math.max(1, entrant.position)}/${race.entrants?.size ?? 1}` +
        (entrant.bestLapMs > 0 ? ` | BEST ${formatRaceTime(entrant.bestLapMs)}` : '');
    }
    this.missionPrevious?.classList.add('hidden');
    this.missionNext?.classList.add('hidden');
    this.missionAction?.classList.add('hidden');
  }

  private updateDeathmatch(state: DistrictNetworkState): void {
    const match = state.deathmatch;
    const entrant = match?.entrants?.get(this.room.sessionId);
    this.missionHud?.classList.toggle('hidden', !match || !entrant);
    if (!match || !entrant) return;
    const serverNow = state.serverTimeMs ?? 0;
    const countdown = Math.max(0, Math.ceil((match.countdownEndsAt - serverNow) / 1_000));
    const remaining = match.phase === 'active'
      ? Math.max(0, match.endsAt - serverNow)
      : match.remainingMs;
    if (this.missionTitle) this.missionTitle.textContent = match.arenaLabel.toUpperCase();
    if (this.missionTimer) {
      this.missionTimer.textContent = match.phase === 'countdown'
        ? String(countdown)
        : formatRaceTime(remaining);
    }
    if (this.missionObjective) {
      this.missionObjective.textContent = match.phase === 'countdown'
        ? 'Choose your weapon. Get ready.'
        : match.phase === 'results'
          ? match.winnerId === entrant.playerId
            ? 'Victory.'
            : `${match.winnerName || 'No winner'} wins.`
          : match.phase === 'waiting'
            ? 'Waiting for combatants.'
            : `First to ${match.scoreLimit} eliminations`;
    }
    if (this.missionMeta) {
      this.missionMeta.textContent =
        `P${Math.max(1, entrant.position)}/${match.entrants?.size ?? 1}` +
        ` | ${entrant.kills} K / ${entrant.deaths} D` +
        (entrant.streak > 1 ? ` | ${entrant.streak} STREAK` : '');
    }
    this.missionPrevious?.classList.add('hidden');
    this.missionNext?.classList.add('hidden');
    this.missionAction?.classList.add('hidden');
  }

  private updateMinimap(state: DistrictNetworkState, nowMs: number): void {
    const local = state.players.get(this.room.sessionId);
    const frame = buildMinimapFrame({
      localPlayerId: this.room.sessionId,
      localPose: this.localPose(),
      players: state.players?.values() ?? [],
      vehicles: state.vehicles?.values() ?? [],
      npcs: state.npcs?.values() ?? [],
      points: [
        ...(state.race?.trackId || state.deathmatch?.arenaId
          ? []
          : missionMinimapPoints(state, this.room.sessionId)),
        ...raceMinimapPoints(state, this.room.sessionId),
        ...storefrontMinimapPoints(local?.spaceId || STREET_SPACE_ID),
        ...serviceMinimapPoints(state, local?.spaceId || STREET_SPACE_ID),
        ...weaponPickupMinimapPoints(state.weaponPickups?.values()),
        ...cashPickupMinimapPoints(state.cashPickups?.values())
      ]
    });
    if (frame) this.minimap?.render(frame, nowMs);
  }

  private readonly handleMissionAction = (event: Event): void => {
    event.stopPropagation();
    const action = this.missionAction?.dataset.action;
    const missionId = this.missionAction?.dataset.missionId ?? '';
    if (action === 'start') {
      this.room.send(MISSION_START_MESSAGE, {templateId: this.selectedTemplate});
    } else if (action === 'join') {
      this.room.send(MISSION_JOIN_MESSAGE, {missionId});
    } else if (action === 'launch') {
      this.room.send(MISSION_LAUNCH_MESSAGE, {missionId});
    } else if (action === 'abandon') {
      this.room.send(MISSION_ABANDON_MESSAGE, {missionId});
    }
  };

  private readonly handlePreviousMission = (event: Event): void => {
    event.stopPropagation();
    this.selectedTemplate = cycleMissionTemplate(this.selectedTemplate, -1);
    this.lastUpdateAt = Number.NEGATIVE_INFINITY;
  };

  private readonly handleNextMission = (event: Event): void => {
    event.stopPropagation();
    this.selectedTemplate = cycleMissionTemplate(this.selectedTemplate, 1);
    this.lastUpdateAt = Number.NEGATIVE_INFINITY;
  };

  private readonly handleDisconnected = (code?: number): void => {
    if (code !== 4000) {
      console.warn(`District connection closed unexpectedly (code ${code ?? 'unknown'}).`);
    }
    this.hud.setConnection(false);
  };
}

function raceMinimapPoints(
  state: DistrictNetworkState,
  playerId: string
): Array<{id: string; kind: 'objective'; x: number; y: number}> {
  const entrant = state.race?.entrants?.get(playerId);
  if (!entrant || entrant.finished || entrant.nextCheckpointRadius <= 0) return [];
  return [{
    id: `race:${state.race?.raceNumber ?? 0}:${entrant.checkpointIndex}`,
    kind: 'objective',
    x: entrant.nextCheckpointX,
    y: entrant.nextCheckpointY
  }];
}

function formatRaceTime(durationMs: number): string {
  const minutes = Math.floor(Math.max(0, durationMs) / 60_000);
  const seconds = ((Math.max(0, durationMs) % 60_000) / 1_000).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

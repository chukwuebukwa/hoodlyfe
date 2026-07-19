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
  projectInteractionAffordance,
  serviceMinimapPoints,
  storefrontMinimapPoints
} from '../interactions/interaction-presentation-policy.ts';
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
import {LocalHudController} from '../ui/local-hud-controller.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {AppearanceCreatorController} from '../appearance/appearance-creator-controller.ts';
import type {ActorRenderPose} from '../rendering/render-types.ts';

const UI_INTERVAL_MS = 100;

export class ThreeDistrictUiController {
  private readonly hud = new LocalHudController();
  private readonly radio: RadioSystem;
  private readonly sfx: SfxSystem;
  private readonly vehicleAudio: VehicleAudioSystem;
  private readonly voice: ProximityVoiceSystem;
  private readonly medical: MedicalCarePresentationController;
  private readonly appearance: AppearanceCreatorController;
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
  private readonly touchInteractionButton = document.querySelector<HTMLButtonElement>('#interact-button');
  private selectedTemplate: MissionTemplateId = DEFAULT_MISSION_TEMPLATE_ID;
  private lastUpdateAt = Number.NEGATIVE_INFINITY;
  private readonly removeNotice: () => void;

  constructor(
    private readonly room: Room<DistrictNetworkState>,
    worldWidth: number,
    worldHeight: number,
    private readonly localPose: () => ActorRenderPose | undefined = () => undefined
  ) {
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
        '/assets/maps/district-preview.png',
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
    return this.appearance.isOpen();
  }

  playerVoiceActivity(playerId: string): number {
    return this.voice.playerVoiceActivity(playerId);
  }

  update(state: DistrictNetworkState, nowMs: number): void {
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
    this.updateInteraction(state);
    if (onStreet) {
      this.updateMission(state);
    } else {
      this.missionHud?.classList.add('hidden');
    }
    this.updateMinimap(state, nowMs);
    const shell = document.querySelector<HTMLElement>('#game-shell');
    if (shell) {
      shell.dataset.players = String(state.players?.size ?? 0);
      shell.dataset.npcs = String(state.npcs?.size ?? 0);
      shell.dataset.vehicles = String(state.vehicles?.size ?? 0);
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
    this.radio.destroy();
    this.sfx.destroy();
    this.vehicleAudio.destroy();
    this.voice.destroy();
    this.hud.destroy();
  }

  private updateInteraction(state: DistrictNetworkState): void {
    const affordance = projectInteractionAffordance(state, this.room.sessionId);
    this.interactionButton?.classList.toggle('hidden', !affordance.visible);
    if (this.interactionButton && affordance.visible) {
      this.interactionButton.textContent = affordance.label;
      this.interactionButton.setAttribute('aria-label', affordance.ariaLabel);
    }
    if (this.touchInteractionButton) {
      this.touchInteractionButton.textContent = affordance.touchLabel;
      this.touchInteractionButton.setAttribute(
        'aria-label',
        affordance.visible ? affordance.ariaLabel : 'Interact'
      );
    }
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
    this.missionAction.classList.toggle('hidden', !projection.action);
    this.missionAction.classList.toggle('warning', projection.actionWarning);
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
        ...missionMinimapPoints(state, this.room.sessionId),
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

  private readonly handleDisconnected = (): void => {
    this.hud.setConnection(false);
  };
}

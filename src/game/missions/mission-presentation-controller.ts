import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import {
  MISSION_ABANDON_MESSAGE,
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_START_MESSAGE
} from '../../../shared/protocol/missions.ts';
import {
  DEFAULT_MISSION_TEMPLATE_ID,
  cycleMissionTemplate,
  type MissionTemplateId
} from '../../../shared/content/mission-catalog.ts';
import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import type {DistrictNetworkState} from '../types.ts';
import {
  missionMinimapPoints,
  projectMissionHud,
  projectMissionWorld
} from './mission-presentation-policy.ts';

export class MissionPresentationController {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly hud: HTMLElement | null;
  private readonly title: Element | null;
  private readonly timer: Element | null;
  private readonly objective: Element | null;
  private readonly meta: Element | null;
  private readonly action: HTMLButtonElement | null;
  private readonly previousTemplate: HTMLButtonElement | null;
  private readonly nextTemplate: HTMLButtonElement | null;
  private state?: DistrictNetworkState;
  private selectedTemplateId: MissionTemplateId = DEFAULT_MISSION_TEMPLATE_ID;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly room: Room<DistrictNetworkState>,
    root: Document = document
  ) {
    this.graphics = scene.add.graphics().setDepth(870_000);
    this.hud = root.querySelector<HTMLElement>('#mission-hud');
    this.title = root.querySelector('#mission-title');
    this.timer = root.querySelector('#mission-timer');
    this.objective = root.querySelector('#mission-objective');
    this.meta = root.querySelector('#mission-meta');
    this.action = root.querySelector<HTMLButtonElement>('#mission-action');
    this.previousTemplate = root.querySelector<HTMLButtonElement>('#mission-prev');
    this.nextTemplate = root.querySelector<HTMLButtonElement>('#mission-next');
    this.action?.addEventListener('click', this.handleAction);
    this.previousTemplate?.addEventListener('click', this.handlePreviousTemplate);
    this.nextTemplate?.addEventListener('click', this.handleNextTemplate);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(state: DistrictNetworkState): void {
    this.state = state;
    const projection = projectMissionHud(state, this.room.sessionId, this.selectedTemplateId);
    this.hud?.classList.toggle('hidden', !projection.visible);
    if (!projection.visible) return;
    if (this.title) this.title.textContent = projection.title;
    if (this.timer) this.timer.textContent = projection.timer;
    if (this.objective) this.objective.textContent = projection.objective;
    if (this.meta) this.meta.textContent = projection.meta;
    this.previousTemplate?.classList.toggle('hidden', !projection.templateSelectorVisible);
    this.nextTemplate?.classList.toggle('hidden', !projection.templateSelectorVisible);
    if (!this.action) return;
    this.action.dataset.action = projection.action;
    this.action.dataset.missionId = projection.missionId;
    this.action.textContent = projection.actionLabel;
    this.action.classList.toggle('hidden', !projection.action);
    this.action.classList.toggle('warning', projection.actionWarning);
  }

  minimapPoints(): MinimapPointInput[] {
    return this.state ? missionMinimapPoints(this.state, this.room.sessionId) : [];
  }

  drawWorld(time: number): void {
    if (!this.state) return;
    const projection = projectMissionWorld(this.state, this.room.sessionId);
    const pulse = 0.65 + (Math.sin(time / 180) + 1) * 0.16;
    this.graphics.clear();
    this.graphics.lineStyle(3, 0xff9d3f, pulse);
    this.graphics.strokeCircle(projection.contact.x, projection.contact.y, 24);
    this.drawContactDiamond(projection.contact.x, projection.contact.y);
    if (projection.delivery) {
      this.graphics.fillStyle(0x63df8a, 0.12);
      this.graphics.fillCircle(
        projection.delivery.x,
        projection.delivery.y,
        projection.delivery.radius
      );
      this.graphics.lineStyle(4, 0x63df8a, pulse);
      this.graphics.strokeCircle(
        projection.delivery.x,
        projection.delivery.y,
        projection.delivery.radius
      );
    }
    if (projection.checkpoint) {
      this.graphics.fillStyle(0x55d6ff, 0.1);
      this.graphics.fillCircle(
        projection.checkpoint.x,
        projection.checkpoint.y,
        projection.checkpoint.radius
      );
      this.graphics.lineStyle(4, 0x55d6ff, pulse);
      this.graphics.strokeCircle(
        projection.checkpoint.x,
        projection.checkpoint.y,
        projection.checkpoint.radius
      );
    }
    if (projection.hold) {
      const color = projection.hold.contested ? 0xff5e4d : 0x55d6ff;
      this.graphics.fillStyle(color, 0.12);
      this.graphics.fillCircle(projection.hold.x, projection.hold.y, projection.hold.radius);
      this.graphics.lineStyle(4, color, pulse);
      this.graphics.strokeCircle(projection.hold.x, projection.hold.y, projection.hold.radius);
    }
    if (!projection.target) return;
    this.graphics.lineStyle(4, 0xf2c94c, pulse);
    this.graphics.strokeCircle(
      projection.target.x,
      projection.target.y,
      34 + Math.sin(time / 130) * 3
    );
    this.graphics.lineBetween(
      projection.target.x,
      projection.target.y - 48,
      projection.target.x - 8,
      projection.target.y - 38
    );
    this.graphics.lineBetween(
      projection.target.x,
      projection.target.y - 48,
      projection.target.x + 8,
      projection.target.y - 38
    );
  }

  destroy(): void {
    this.action?.removeEventListener('click', this.handleAction);
    this.previousTemplate?.removeEventListener('click', this.handlePreviousTemplate);
    this.nextTemplate?.removeEventListener('click', this.handleNextTemplate);
    this.graphics.destroy();
    this.state = undefined;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private drawContactDiamond(x: number, y: number): void {
    this.graphics.lineBetween(x, y - 32, x + 8, y - 24);
    this.graphics.lineBetween(x + 8, y - 24, x, y - 16);
    this.graphics.lineBetween(x, y - 16, x - 8, y - 24);
    this.graphics.lineBetween(x - 8, y - 24, x, y - 32);
  }

  private readonly handleAction = (event: Event): void => {
    event.stopPropagation();
    const action = this.action?.dataset.action;
    const missionId = this.action?.dataset.missionId ?? '';
    if (action === 'start') {
      this.room.send(MISSION_START_MESSAGE, {templateId: this.selectedTemplateId});
    }
    else if (action === 'join') this.room.send(MISSION_JOIN_MESSAGE, {missionId});
    else if (action === 'launch') this.room.send(MISSION_LAUNCH_MESSAGE, {missionId});
    else if (action === 'abandon') this.room.send(MISSION_ABANDON_MESSAGE, {missionId});
  };

  private readonly handlePreviousTemplate = (event: Event): void => {
    event.stopPropagation();
    this.selectTemplate(-1);
  };

  private readonly handleNextTemplate = (event: Event): void => {
    event.stopPropagation();
    this.selectTemplate(1);
  };

  private selectTemplate(direction: -1 | 1): void {
    this.selectedTemplateId = cycleMissionTemplate(this.selectedTemplateId, direction);
    if (this.state) this.synchronize(this.state);
  }
}

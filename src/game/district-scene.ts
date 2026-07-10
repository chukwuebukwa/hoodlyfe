import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import {GAME_NOTICE_MESSAGE, type GameNotice} from '../../shared/protocol/notices.ts';
import {CameraPresentationController} from './camera/camera-presentation-controller.ts';
import {AppearanceCreatorController} from './appearance/appearance-creator-controller.ts';
import {DebugPresentationController} from './debug/debug-presentation-controller.ts';
import {ClientInputController} from './input/client-input-controller.ts';
import {InteractionPresentationController} from './interactions/interaction-presentation-controller.ts';
import {buildMinimapFrame} from './minimap-marker-policy.ts';
import {MinimapRenderer} from './minimap-renderer.ts';
import {MissionPresentationController} from './missions/mission-presentation-controller.ts';
import {PedestrianRenderer} from './rendering/pedestrian-renderer.ts';
import {PlayerRenderer} from './rendering/player-renderer.ts';
import {ProjectileRenderer} from './rendering/projectile-renderer.ts';
import {VehicleRenderer} from './rendering/vehicle-renderer.ts';
import {LocalHudController} from './ui/local-hud-controller.ts';
import type {DistrictNetworkState} from './types.ts';

const PLAYER_RADIUS = 11;

export class DistrictScene extends Phaser.Scene {
  private readonly room: Room<DistrictNetworkState>;
  private cameraController!: CameraPresentationController;
  private appearanceController!: AppearanceCreatorController;
  private debugController!: DebugPresentationController;
  private missionController!: MissionPresentationController;
  private pedestrianRenderer!: PedestrianRenderer;
  private playerRenderer!: PlayerRenderer;
  private projectileRenderer!: ProjectileRenderer;
  private vehicleRenderer!: VehicleRenderer;
  private hudController!: LocalHudController;
  private inputController!: ClientInputController;
  private interactionController!: InteractionPresentationController;
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;
  private crosshair!: Phaser.GameObjects.Graphics;
  private minimap?: MinimapRenderer;
  private latestState?: DistrictNetworkState;
  private lastMinimapDrawAt = Number.NEGATIVE_INFINITY;

  constructor(room: Room<DistrictNetworkState>) {
    super('district');
    this.room = room;
  }

  preload(): void {
    this.load.tilemapTiledJSON('district-map', '/assets/maps/district-map.json');
    this.load.image('district-tiles', '/assets/maps/district-tiles.png');
    this.load.image('district-preview', '/assets/maps/district-preview.png');
    this.load.image('district-overlay', '/assets/maps/district-overlay.png');
    this.load.spritesheet('driver', '/assets/original/sprites/player-base.png', {
      frameWidth: 72,
      frameHeight: 72
    });
    this.load.spritesheet('civilian', '/assets/original/sprites/civilian.png', {
      frameWidth: 72,
      frameHeight: 72
    });
    this.load.spritesheet('police', '/assets/original/sprites/police.png', {
      frameWidth: 72,
      frameHeight: 72
    });
    this.load.spritesheet('vehicles', '/assets/original/sprites/vehicles.png', {
      frameWidth: 96,
      frameHeight: 96
    });
    this.load.svg('weapon-pistol', '/assets/original/weapons/pistol.svg');
    this.load.svg('weapon-smg', '/assets/original/weapons/smg.svg');
    this.load.svg('weapon-shotgun', '/assets/original/weapons/shotgun.svg');
  }

  create(): void {
    const map = this.make.tilemap({key: 'district-map'});
    const tileset = map.addTilesetImage('district', 'district-tiles');
    if (!tileset) throw new Error('Industrial District tileset could not be loaded.');
    this.add.image(0, 0, 'district-preview').setOrigin(0).setDepth(0);
    this.add.image(0, 0, 'district-overlay').setOrigin(0).setDepth(850_000);
    const collisions = map.createLayer('collisions', tileset);
    if (!collisions) throw new Error('Industrial District collisions could not be loaded.');
    this.collisionLayer = collisions.setVisible(false);

    this.cameraController = new CameraPresentationController(this);
    this.cameraController.configure(map.widthInPixels, map.heightInPixels);
    this.hudController = new LocalHudController();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.hudController.destroy, this.hudController);
    this.missionController = new MissionPresentationController(this, this.room);
    this.interactionController = new InteractionPresentationController(this, this.room.sessionId);
    this.appearanceController = new AppearanceCreatorController(this.room, this.room.sessionId);
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      this.appearanceController.destroy,
      this.appearanceController
    );
    this.input.setDefaultCursor('crosshair');

    this.createPedestrianAnimation('driver-walk', 'driver');
    this.createPedestrianAnimation('civilian-walk', 'civilian');
    this.createPedestrianAnimation('police-walk', 'police');
    this.pedestrianRenderer = new PedestrianRenderer(this);
    this.vehicleRenderer = new VehicleRenderer(this, {
      onLocalOccupant: (vehicleId, container) => {
        this.cameraController.followVehicle(vehicleId, container);
      }
    });
    this.playerRenderer = new PlayerRenderer(this, {
      localPlayerId: this.room.sessionId,
      vehiclePose: (vehicleId) => this.vehicleRenderer.pose(vehicleId),
      canOccupy: (x, y) => this.canOccupy(x, y),
      onLocalState: (playerId, player, sprite, damaged) => {
        const vehicle = player.vehicleId ? this.latestState?.vehicles?.get(player.vehicleId) : undefined;
        this.hudController.update(player, vehicle);
        if (!player.vehicleId) this.cameraController.followPlayer(playerId, sprite, player.x, player.y);
        if (damaged) this.cameraController.localDamageFeedback();
      }
    });
    this.projectileRenderer = new ProjectileRenderer(this, {
      onCreated: (bullet) => {
        this.playerRenderer.projectileCreated(bullet.ownerId, this.time.now);
      }
    });

    const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap-canvas');
    if (minimapCanvas) {
      this.minimap = new MinimapRenderer(
        minimapCanvas,
        '/assets/maps/district-preview.png',
        map.widthInPixels,
        map.heightInPixels
      );
    }

    if (!this.input.keyboard) throw new Error('Keyboard input is unavailable.');
    this.debugController = new DebugPresentationController(
      this,
      this.room,
      map,
      this.collisionLayer
    );
    this.inputController = new ClientInputController({
      scene: this,
      room: this.room,
      getPlayer: () => this.latestState?.players?.get(this.room.sessionId),
      getAimOrigin: () => this.playerRenderer.aimOrigin(this.room.sessionId),
      onAim: (angle) => this.playerRenderer.setAim(this.room.sessionId, angle),
      isBlocked: () => this.appearanceController.isOpen()
    });
    this.inputController.start();

    this.crosshair = this.add.graphics().setScrollFactor(0).setDepth(1_000_000);
    this.room.onMessage<GameNotice>(GAME_NOTICE_MESSAGE, (notice) => {
      this.hudController.show(notice.message, notice.tone);
    });
    this.room.onStateChange((state) => {
      this.latestState = state;
      this.synchronizeState(state);
    });
    this.room.onLeave(() => this.hudController.setConnection(false));
    this.room.onError(() => this.hudController.setConnection(false));
    this.latestState = this.room.state;
    this.synchronizeState(this.room.state);
    this.hudController.setConnection(true);
    document.querySelector('#loading')?.classList.add('hidden');
  }

  update(time: number, delta: number): void {
    const input = this.inputController.update(time);
    this.playerRenderer.predictLocalMovement(input.x, input.y, delta / 1000);
    this.interpolateEntities(time);
    this.debugController.update(time);
    this.updateMinimap(time);
    this.missionController.drawWorld(time);
    this.interactionController.drawWorld(time);
    this.drawCrosshair();
  }

  private createPedestrianAnimation(key: string, texture: string): void {
    this.anims.create({
      key,
      frames: this.anims.generateFrameNumbers(texture, {start: 1, end: 8}),
      frameRate: 9,
      repeat: -1
    });
  }

  private synchronizeState(state: DistrictNetworkState): void {
    this.playerRenderer.synchronize(state.players);
    this.pedestrianRenderer.synchronize(state.npcs);
    const localVehicleId = state.players?.get(this.room.sessionId)?.vehicleId ?? '';
    this.vehicleRenderer.synchronize(state.vehicles, localVehicleId);
    this.projectileRenderer.synchronize(state.bullets);
    const shell = document.querySelector<HTMLElement>('#game-shell');
    if (shell) {
      shell.dataset.players = String(state.players?.size ?? 0);
      shell.dataset.npcs = String(state.npcs?.size ?? 0);
      shell.dataset.vehicles = String(state.vehicles?.size ?? 0);
    }
    this.interactionController.synchronize(state);
    this.missionController.synchronize(state);
    this.appearanceController.synchronize(state);
    this.debugController.synchronize(state);
  }

  private interpolateEntities(time: number): void {
    this.vehicleRenderer.interpolate(time);
    this.playerRenderer.interpolate(time);
    this.pedestrianRenderer.interpolate();
    this.projectileRenderer.interpolate();
  }

  private canOccupy(x: number, y: number): boolean {
    const diagonal = PLAYER_RADIUS * 0.72;
    const samples = [
      [x - PLAYER_RADIUS, y], [x + PLAYER_RADIUS, y], [x, y - PLAYER_RADIUS], [x, y + PLAYER_RADIUS],
      [x - diagonal, y - diagonal], [x + diagonal, y - diagonal],
      [x - diagonal, y + diagonal], [x + diagonal, y + diagonal]
    ];
    return samples.every(([sampleX, sampleY]) => !this.collisionLayer.hasTileAtWorldXY(sampleX, sampleY));
  }

  private drawCrosshair(): void {
    this.crosshair.clear();
    if (this.inputController.usesTouchAim()) return;
    const pointer = this.input.activePointer;
    this.crosshair.lineStyle(1, 0xffffff, 0.9);
    this.crosshair.strokeCircle(pointer.x, pointer.y, 8);
    this.crosshair.lineBetween(pointer.x - 13, pointer.y, pointer.x - 5, pointer.y);
    this.crosshair.lineBetween(pointer.x + 5, pointer.y, pointer.x + 13, pointer.y);
    this.crosshair.lineBetween(pointer.x, pointer.y - 13, pointer.x, pointer.y - 5);
    this.crosshair.lineBetween(pointer.x, pointer.y + 5, pointer.x, pointer.y + 13);
  }

  private updateMinimap(time: number): void {
    if (!this.minimap || !this.latestState || time - this.lastMinimapDrawAt < 100) return;
    this.lastMinimapDrawAt = time;
    const frame = buildMinimapFrame({
      localPlayerId: this.room.sessionId,
      players: this.latestState.players?.values() ?? [],
      vehicles: this.latestState.vehicles?.values() ?? [],
      npcs: this.latestState.npcs?.values() ?? [],
      points: [
        ...this.missionController.minimapPoints(),
        ...this.interactionController.minimapPoints()
      ]
    });
    if (frame) this.minimap.render(frame, time);
  }

}

import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import {VEHICLE_INPUT_MESSAGE} from '../../shared/protocol/vehicle-input.ts';
import {ON_FOOT_INPUT_MESSAGE} from '../../shared/protocol/on-foot-input.ts';
import {STREET_SPACE_ID} from '../../shared/content/interior-catalog.ts';
import {GAME_NOTICE_MESSAGE, type GameNotice} from '../../shared/protocol/notices.ts';
import {CameraPresentationController} from './camera/camera-presentation-controller.ts';
import {AppearanceCreatorController} from './appearance/appearance-creator-controller.ts';
import {DebugPresentationController} from './debug/debug-presentation-controller.ts';
import {ClientInputController} from './input/client-input-controller.ts';
import {InteractionPresentationController} from './interactions/interaction-presentation-controller.ts';
import {buildMinimapFrame} from './minimap-marker-policy.ts';
import {MinimapRenderer} from './minimap-renderer.ts';
import {MissionPresentationController} from './missions/mission-presentation-controller.ts';
import {MedicalCarePresentationController} from './medical/medical-care-presentation-controller.ts';
import {PedestrianRenderer} from './rendering/pedestrian-renderer.ts';
import {PlayerRenderer} from './rendering/player-renderer.ts';
import {ProjectileRenderer} from './rendering/projectile-renderer.ts';
import {RocketProjectileRenderer} from './rendering/rocket-projectile-renderer.ts';
import {ExplosionRenderer} from './rendering/explosion-renderer.ts';
import {ThrownProjectileRenderer} from './rendering/thrown-projectile-renderer.ts';
import {FireZoneRenderer} from './rendering/fire-zone-renderer.ts';
import {WeaponPickupRenderer} from './rendering/weapon-pickup-renderer.ts';
import {CashPickupRenderer} from './rendering/cash-pickup-renderer.ts';
import {TrafficSignalRenderer} from './rendering/traffic-signal-renderer.ts';
import {VehicleRenderer} from './rendering/vehicle-renderer.ts';
import {RadioSystem} from './audio/radio-system.ts';
import {SfxSystem} from './audio/sfx-system.ts';
import {VehicleAudioSystem} from './audio/vehicle-audio-system.ts';
import {NetworkQualityController} from './network/network-quality-controller.ts';
import {InteractionIslandController} from './network/interaction-island-controller.ts';
import type {InteractionSnapshotInbox} from './network/interaction-snapshot-inbox.ts';
import {LocalHudController} from './ui/local-hud-controller.ts';
import type {DistrictNetworkState} from './types.ts';
import {canOccupyClientInterior} from './world/client-collision-map.ts';
import {WORLD_COLLISION_REVISION} from '../../shared/simulation/world-collision-revision.ts';
import {
  createVehicleInteractionBodyStep,
  createVehicleInteractionPairStep
} from './prediction/vehicle-interaction-replay.ts';

const PLAYER_RADIUS = 11;

export class DistrictScene extends Phaser.Scene {
  private readonly room: Room<DistrictNetworkState>;
  private cameraController!: CameraPresentationController;
  private appearanceController!: AppearanceCreatorController;
  private debugController!: DebugPresentationController;
  private missionController!: MissionPresentationController;
  private medicalController!: MedicalCarePresentationController;
  private pedestrianRenderer!: PedestrianRenderer;
  private playerRenderer!: PlayerRenderer;
  private projectileRenderer!: ProjectileRenderer;
  private rocketProjectileRenderer!: RocketProjectileRenderer;
  private explosionRenderer!: ExplosionRenderer;
  private thrownProjectileRenderer!: ThrownProjectileRenderer;
  private fireZoneRenderer!: FireZoneRenderer;
  private weaponPickupRenderer!: WeaponPickupRenderer;
  private cashPickupRenderer!: CashPickupRenderer;
  private trafficSignalRenderer!: TrafficSignalRenderer;
  private vehicleRenderer!: VehicleRenderer;
  private radioSystem!: RadioSystem;
  private sfxSystem!: SfxSystem;
  private vehicleAudioSystem!: VehicleAudioSystem;
  private hudController!: LocalHudController;
  private inputController!: ClientInputController;
  private interactionController!: InteractionPresentationController;
  private networkQuality!: NetworkQualityController;
  private interactionIslands?: InteractionIslandController;
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;
  private crosshair!: Phaser.GameObjects.Graphics;
  private minimap?: MinimapRenderer;
  private latestState?: DistrictNetworkState;
  private lastMinimapDrawAt = Number.NEGATIVE_INFINITY;

  constructor(
    room: Room<DistrictNetworkState>,
    private readonly interactionSnapshots?: InteractionSnapshotInbox
  ) {
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
    this.load.spritesheet('hostile', '/assets/original/sprites/civilian.png', {
      frameWidth: 72,
      frameHeight: 72
    });
    this.load.spritesheet('vehicles', '/assets/original/sprites/vehicles.png', {
      frameWidth: 96,
      frameHeight: 96
    });
    this.load.svg('weapon-fists', '/assets/original/weapons/fists.svg');
    this.load.svg('weapon-bat', '/assets/original/weapons/bat.svg');
    this.load.svg('weapon-pistol', '/assets/original/weapons/pistol.svg');
    this.load.svg('weapon-smg', '/assets/original/weapons/smg.svg');
    this.load.svg('weapon-shotgun', '/assets/original/weapons/shotgun.svg');
    this.load.svg('weapon-rocket', '/assets/original/weapons/rocket.svg');
    this.load.svg('weapon-grenade', '/assets/original/weapons/grenade.svg');
    this.load.svg('weapon-molotov', '/assets/original/weapons/molotov.svg');
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
    this.networkQuality = new NetworkQualityController(this.room);
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      this.networkQuality.destroy,
      this.networkQuality
    );
    this.cameraController = new CameraPresentationController(this);
    this.cameraController.configure(map.widthInPixels, map.heightInPixels);
    this.hudController = new LocalHudController();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.hudController.destroy, this.hudController);
    this.radioSystem = new RadioSystem(document, this.room);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.radioSystem.destroy, this.radioSystem);
    this.sfxSystem = new SfxSystem(this.room);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.sfxSystem.destroy, this.sfxSystem);
    this.vehicleAudioSystem = new VehicleAudioSystem();
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      this.vehicleAudioSystem.destroy,
      this.vehicleAudioSystem
    );
    this.missionController = new MissionPresentationController(this, this.room);
    this.medicalController = new MedicalCarePresentationController(this.room);
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      this.medicalController.destroy,
      this.medicalController
    );
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
    this.createPedestrianAnimation('hostile-walk', 'hostile');
    this.pedestrianRenderer = new PedestrianRenderer(this, {
      onRemoteTimeline: (sample) => this.networkQuality.observeRemoteTimeline(sample)
    });
    this.vehicleRenderer = new VehicleRenderer(this, {
      onLocalOccupant: (vehicleId, container) => {
        this.cameraController.followVehicle(vehicleId, container);
      },
      onPrediction: (error, snapped, pending, acknowledged, resimulated) => {
        this.networkQuality?.observePrediction(error, snapped, pending, acknowledged, resimulated);
      },
      canOccupy: (x, y, radius) => this.canOccupy(x, y, radius),
      sendVehicleMoves: (vehicleId, moves) => {
        if (vehicleId) this.room.send(VEHICLE_INPUT_MESSAGE, {vehicleId, moves});
      },
      onRemoteTimeline: (sample) => this.networkQuality.observeRemoteTimeline(sample)
    });
    if (this.interactionSnapshots) {
      const canOccupyInteraction = (spaceId: string, x: number, y: number, radius: number) => (
        spaceId === STREET_SPACE_ID
          ? this.canOccupy(x, y, radius)
          : canOccupyClientInterior(spaceId, x, y, radius)
      );
      this.interactionIslands = new InteractionIslandController(this.interactionSnapshots, {
        networkConditions: () => {
          const network = this.networkQuality.snapshot();
          return {
            rttMs: network.rttP95Ms,
            interpolationDelayMs: network.interpolationDelayMs,
            jitterMs: network.jitterMs
          };
        },
        onHistory: (frames) => this.networkQuality.observeInteractionHistory(frames),
        onSelection: (selection) => this.networkQuality.observeInteractionIsland(selection),
        replay: {
          prepare: (baseline) => this.vehicleRenderer.prepareInteractionReplay(baseline),
          worldCollisionRevision: () => WORLD_COLLISION_REVISION,
          stepBody: createVehicleInteractionBodyStep(canOccupyInteraction),
          resolvePair: createVehicleInteractionPairStep(canOccupyInteraction),
          onReplay: (result, durationMs, baseline) => {
            this.vehicleRenderer.applyInteractionReplay(baseline, result);
            this.networkQuality.observeInteractionReplay(result, durationMs);
          }
        }
      });
      this.events.once(
        Phaser.Scenes.Events.SHUTDOWN,
        this.interactionIslands.destroy,
        this.interactionIslands
      );
    }
    this.playerRenderer = new PlayerRenderer(this, {
      localPlayerId: this.room.sessionId,
      vehiclePose: (vehicleId) => this.vehicleRenderer.pose(vehicleId),
      canOccupy: (spaceId, x, y, radius) => spaceId === STREET_SPACE_ID
        ? this.canOccupy(x, y, radius)
        : canOccupyClientInterior(spaceId, x, y, radius),
      onPrediction: (error, snapped, pending, acknowledged, resimulated) => {
        this.networkQuality?.observeOnFootPrediction(
          error,
          snapped,
          pending,
          acknowledged,
          resimulated
        );
      },
      onRemoteTimeline: (sample) => this.networkQuality.observeRemoteTimeline(sample),
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
    this.rocketProjectileRenderer = new RocketProjectileRenderer(this);
    this.thrownProjectileRenderer = new ThrownProjectileRenderer(this);
    this.fireZoneRenderer = new FireZoneRenderer(this);
    this.explosionRenderer = new ExplosionRenderer(this);
    this.weaponPickupRenderer = new WeaponPickupRenderer(this);
    this.cashPickupRenderer = new CashPickupRenderer(this);
    this.trafficSignalRenderer = new TrafficSignalRenderer(this);

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
      this.collisionLayer,
      () => this.networkQuality.snapshot(),
      (vehicleId) => this.vehicleRenderer.pose(vehicleId)
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
    this.networkQuality.update(time);
    const input = this.inputController.update(time);
    this.interpolateEntities(time, delta / 1000);
    const onFootMoves = this.playerRenderer.predictLocalMovement(input.x, input.y, delta / 1000);
    if (onFootMoves.length > 0) this.room.send(ON_FOOT_INPUT_MESSAGE, {moves: onFootMoves});
    this.vehicleRenderer.predictLocalVehicle(input, delta / 1000);
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
    this.playerRenderer.synchronize(state.players, state.serverTimeMs ?? 0);
    this.pedestrianRenderer.synchronize(state.npcs, state.serverTimeMs ?? 0);
    const localVehicleId = state.players?.get(this.room.sessionId)?.vehicleId ?? '';
    const localPlayer = state.players?.get(this.room.sessionId);
    const localDriverVehicleId = localPlayer?.vehicleSeat === 0 ? localVehicleId : '';
    this.medicalController.synchronize(state.players?.get(this.room.sessionId));
    this.vehicleRenderer.synchronize(
      state.vehicles,
      localVehicleId,
      localDriverVehicleId,
      localPlayer?.lastVehicleInputSequence ?? 0,
      state.serverTimeMs ?? 0
    );
    const local = localPlayer;
    this.radioSystem.synchronize(
      local,
      local?.vehicleId ? state.vehicles?.get(local.vehicleId) : undefined
    );
    this.sfxSystem.synchronize(
      local,
      local?.vehicleId ? state.vehicles?.get(local.vehicleId) : undefined
    );
    this.vehicleAudioSystem.synchronize(
      local,
      local?.vehicleId ? state.vehicles?.get(local.vehicleId) : undefined,
      state.vehicles
    );
    this.projectileRenderer.synchronize(state.bullets);
    this.rocketProjectileRenderer.synchronize(state.rockets);
    this.thrownProjectileRenderer.synchronize(state.thrownProjectiles);
    this.fireZoneRenderer.synchronize(state.fires);
    this.explosionRenderer.synchronize(state.explosions);
    this.weaponPickupRenderer.synchronize(state.weaponPickups);
    this.cashPickupRenderer.synchronize(state.cashPickups);
    this.trafficSignalRenderer.synchronize(state.trafficSignals);
    const shell = document.querySelector<HTMLElement>('#game-shell');
    if (shell) {
      shell.dataset.players = String(state.players?.size ?? 0);
      shell.dataset.npcs = String(state.npcs?.size ?? 0);
      shell.dataset.vehicles = String(state.vehicles?.size ?? 0);
      shell.dataset.explosives = String(
        (state.rockets?.size ?? 0) +
        (state.thrownProjectiles?.size ?? 0) +
        (state.explosions?.size ?? 0) +
        (state.fires?.size ?? 0)
      );
    }
    this.interactionController.synchronize(state);
    this.missionController.synchronize(state);
    this.appearanceController.synchronize(state);
    this.debugController.synchronize(state);
  }

  private interpolateEntities(time: number, deltaSeconds: number): void {
    const quality = this.networkQuality.snapshot();
    const renderServerTime = quality.estimatedServerTimeMs - quality.interpolationDelayMs;
    this.vehicleRenderer.interpolate(
      time,
      deltaSeconds,
      renderServerTime,
      quality.estimatedServerTimeMs
    );
    this.playerRenderer.interpolate(
      time,
      renderServerTime,
      quality.estimatedServerTimeMs
    );
    this.pedestrianRenderer.interpolate(renderServerTime, quality.estimatedServerTimeMs);
    this.projectileRenderer.interpolate();
    this.rocketProjectileRenderer.interpolate();
    this.thrownProjectileRenderer.interpolate();
    this.fireZoneRenderer.update(time);
    this.weaponPickupRenderer.interpolate();
    this.cashPickupRenderer.interpolate();
  }

  private canOccupy(x: number, y: number, radius = PLAYER_RADIUS): boolean {
    if (
      x - radius < 0 || y - radius < 0 ||
      x + radius >= this.collisionLayer.tilemap.widthInPixels ||
      y + radius >= this.collisionLayer.tilemap.heightInPixels
    ) return false;
    const diagonal = radius * 0.72;
    const samples = [
      [x - radius, y], [x + radius, y], [x, y - radius], [x, y + radius],
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
        ...this.interactionController.minimapPoints(),
        ...this.weaponPickupRenderer.minimapPoints(),
        ...this.cashPickupRenderer.minimapPoints()
      ]
    });
    if (frame) this.minimap.render(frame, time);
  }

}

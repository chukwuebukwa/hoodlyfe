import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import type {DebugSnapshot} from '../../shared/protocol/debug.ts';
import {
  MISSION_NOTICE_MESSAGE,
  type MissionNotice
} from '../../shared/protocol/missions.ts';
import {ClientInputController} from './input/client-input-controller.ts';
import {DebugSnapshotSubscription} from './debug/debug-snapshot-subscription.ts';
import {buildMinimapFrame} from './minimap-marker-policy.ts';
import type {MinimapPointInput} from './minimap-marker-policy.ts';
import {MinimapRenderer} from './minimap-renderer.ts';
import {PedestrianRenderer} from './rendering/pedestrian-renderer.ts';
import {PlayerRenderer} from './rendering/player-renderer.ts';
import {ProjectileRenderer} from './rendering/projectile-renderer.ts';
import {VehicleRenderer} from './rendering/vehicle-renderer.ts';
import type {
  DistrictNetworkState,
  NetworkMission,
  NetworkPlayer,
  NetworkVehicle
} from './types.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const SPATIAL_CELL_SIZE = 256;
const DEBUG_DRAW_INTERVAL = 100;

export class DistrictScene extends Phaser.Scene {
  private readonly room: Room<DistrictNetworkState>;
  private pedestrianRenderer!: PedestrianRenderer;
  private playerRenderer!: PlayerRenderer;
  private projectileRenderer!: ProjectileRenderer;
  private vehicleRenderer!: VehicleRenderer;
  private debugSubscription!: DebugSnapshotSubscription;
  private inputController!: ClientInputController;
  private debugKey!: Phaser.Input.Keyboard.Key;
  private tilemap!: Phaser.Tilemaps.Tilemap;
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;
  private crosshair!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private missionGraphics!: Phaser.GameObjects.Graphics;
  private readonly debugLabels = new Map<string, Phaser.GameObjects.Text>();
  private minimap?: MinimapRenderer;
  private lastWanted = 0;
  private lastCash = 0;
  private lastLocalAction = '';
  private cameraTargetId = '';
  private toastTimeout?: number;
  private latestState?: DistrictNetworkState;
  private latestDebugSnapshot?: DebugSnapshot;
  private debugVisible = false;
  private lastDebugDrawAt = Number.NEGATIVE_INFINITY;
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
    this.tilemap = map;
    const tileset = map.addTilesetImage('district', 'district-tiles');
    if (!tileset) throw new Error('Industrial District tileset could not be loaded.');
    this.add.image(0, 0, 'district-preview').setOrigin(0).setDepth(0);
    this.add.image(0, 0, 'district-overlay').setOrigin(0).setDepth(850_000);
    const collisions = map.createLayer('collisions', tileset);
    if (!collisions) throw new Error('Industrial District collisions could not be loaded.');
    this.collisionLayer = collisions.setVisible(false);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBackgroundColor('#080808');
    this.cameras.main.setZoom(window.innerWidth < 700 ? 1.05 : 1.15);
    this.input.setDefaultCursor('crosshair');
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.cameras.main.setZoom(size.width < 700 ? 1.05 : 1.15);
    });

    this.createPedestrianAnimation('driver-walk', 'driver');
    this.createPedestrianAnimation('civilian-walk', 'civilian');
    this.createPedestrianAnimation('police-walk', 'police');
    this.pedestrianRenderer = new PedestrianRenderer(this);
    this.vehicleRenderer = new VehicleRenderer(this, {
      onLocalOccupant: (vehicleId, container) => {
        if (this.cameraTargetId === `vehicle:${vehicleId}`) return;
        this.cameras.main.startFollow(container, true, 0.12, 0.12);
        this.cameraTargetId = `vehicle:${vehicleId}`;
      }
    });
    this.playerRenderer = new PlayerRenderer(this, {
      localPlayerId: this.room.sessionId,
      vehiclePose: (vehicleId) => this.vehicleRenderer.pose(vehicleId),
      canOccupy: (x, y) => this.canOccupy(x, y),
      onLocalState: (playerId, player, sprite, damaged) => {
        this.updateHud(player);
        if (!player.vehicleId && this.cameraTargetId !== `player:${playerId}`) {
          this.cameras.main.startFollow(sprite, true, 0.14, 0.14);
          this.cameras.main.centerOn(player.x, player.y);
          this.cameraTargetId = `player:${playerId}`;
        }
        if (damaged) {
          this.cameras.main.shake(110, 0.004);
          this.cameras.main.flash(90, 150, 20, 20, false);
        }
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
    this.debugKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F3);
    this.inputController = new ClientInputController({
      scene: this,
      room: this.room,
      getPlayer: () => this.latestState?.players?.get(this.room.sessionId),
      getAimOrigin: () => this.playerRenderer.aimOrigin(this.room.sessionId),
      onAim: (angle) => this.playerRenderer.setAim(this.room.sessionId, angle)
    });
    this.inputController.start();
    document.querySelector('#debug-toggle')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setDebugVisible(!this.debugVisible);
    });

    this.debugGraphics = this.add.graphics().setDepth(980_000);
    this.missionGraphics = this.add.graphics().setDepth(870_000);
    this.crosshair = this.add.graphics().setScrollFactor(0).setDepth(1_000_000);
    this.debugSubscription = new DebugSnapshotSubscription({
      room: this.room,
      onSnapshot: (snapshot) => {
        this.latestDebugSnapshot = snapshot;
        this.updateDebugPanel();
      }
    });
    this.debugSubscription.start();
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      this.debugSubscription.destroy,
      this.debugSubscription
    );
    this.room.onMessage<MissionNotice>(MISSION_NOTICE_MESSAGE, (notice) => {
      this.showToast(notice.message, notice.tone);
    });
    this.room.onStateChange((state) => {
      this.latestState = state;
      this.synchronizeState(state);
    });
    this.room.onLeave(() => this.setConnectionState(false));
    this.room.onError(() => this.setConnectionState(false));
    this.latestState = this.room.state;
    this.synchronizeState(this.room.state);
    this.setConnectionState(true);
    document.querySelector('#loading')?.classList.add('hidden');
  }

  update(time: number, delta: number): void {
    const input = this.inputController.update(time);
    this.playerRenderer.predictLocalMovement(input.x, input.y, delta / 1000);
    this.interpolateEntities(time);
    this.updateDebugView(time);
    this.updateMinimap(time);
    this.drawMissionWorld(time);
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
    this.updateVehicleActionButton();
    this.updateMissionHud();
    this.updateDebugPanel();
  }

  private updateVehicleActionButton(): void {
    const button = document.querySelector<HTMLButtonElement>('#vehicle-action-button');
    const player = this.latestState?.players?.get(this.room.sessionId);
    if (!button || !player?.alive || player.action) {
      button?.classList.add('hidden');
      return;
    }
    if (player.vehicleId) {
      button.textContent = 'EXIT CAR';
      button.classList.remove('hidden');
      return;
    }
    let nearest: NetworkVehicle | undefined;
    let nearestDistance = 82;
    this.latestState?.vehicles?.forEach((vehicle) => {
      if (vehicle.destroyed) return;
      const distance = Math.hypot(vehicle.x - player.x, vehicle.y - player.y);
      if (distance < nearestDistance) {
        nearest = vehicle;
        nearestDistance = distance;
      }
    });
    if (!nearest) {
      button.classList.add('hidden');
      return;
    }
    button.textContent = nearest.traffic ? 'HIJACK CAR' : (nearest.driverId ? 'RIDE ALONG' : 'ENTER CAR');
    button.classList.remove('hidden');
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

  private updateDebugView(time: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.debugKey)) {
      this.setDebugVisible(!this.debugVisible);
    }
    if (!this.debugVisible || time - this.lastDebugDrawAt < DEBUG_DRAW_INTERVAL) return;
    this.lastDebugDrawAt = time;
    this.drawDebugWorld();
  }

  private updateMinimap(time: number): void {
    if (!this.minimap || !this.latestState || time - this.lastMinimapDrawAt < 100) return;
    this.lastMinimapDrawAt = time;
    const frame = buildMinimapFrame({
      localPlayerId: this.room.sessionId,
      players: this.latestState.players?.values() ?? [],
      vehicles: this.latestState.vehicles?.values() ?? [],
      npcs: this.latestState.npcs?.values() ?? [],
      points: this.missionMinimapPoints()
    });
    if (frame) this.minimap.render(frame, time);
  }

  private missionMinimapPoints(): MinimapPointInput[] {
    const state = this.latestState;
    if (!state) return [];
    const points: MinimapPointInput[] = [{
      id: 'boost-contact',
      kind: 'contact',
      x: state.missionContactX,
      y: state.missionContactY
    }];
    const mission = this.localMission();
    if (!mission || mission.phase === 'forming' || mission.phase === 'completed' || mission.phase === 'failed') {
      return points;
    }
    if (mission.phase === 'deliver') {
      points.push({
        id: `${mission.id}:delivery`,
        kind: 'objective',
        x: mission.deliveryX,
        y: mission.deliveryY
      });
      return points;
    }
    const target = state.vehicles?.get(mission.targetVehicleId);
    if (target) {
      points.push({
        id: `${mission.id}:target`,
        kind: 'objective',
        x: target.x,
        y: target.y,
        angle: target.angle
      });
    }
    return points;
  }

  private drawMissionWorld(time: number): void {
    const state = this.latestState;
    if (!state || !this.missionGraphics) return;
    const graphics = this.missionGraphics;
    graphics.clear();
    const pulse = 0.65 + (Math.sin(time / 180) + 1) * 0.16;
    graphics.lineStyle(3, 0xff9d3f, pulse);
    graphics.strokeCircle(state.missionContactX, state.missionContactY, 24);
    graphics.lineBetween(
      state.missionContactX,
      state.missionContactY - 32,
      state.missionContactX + 8,
      state.missionContactY - 24
    );
    graphics.lineBetween(
      state.missionContactX + 8,
      state.missionContactY - 24,
      state.missionContactX,
      state.missionContactY - 16
    );
    graphics.lineBetween(
      state.missionContactX,
      state.missionContactY - 16,
      state.missionContactX - 8,
      state.missionContactY - 24
    );
    graphics.lineBetween(
      state.missionContactX - 8,
      state.missionContactY - 24,
      state.missionContactX,
      state.missionContactY - 32
    );

    const mission = this.localMission();
    if (!mission || mission.phase === 'forming' || mission.phase === 'completed' || mission.phase === 'failed') return;
    if (mission.phase === 'deliver') {
      graphics.fillStyle(0x63df8a, 0.12);
      graphics.fillCircle(mission.deliveryX, mission.deliveryY, mission.deliveryRadius);
      graphics.lineStyle(4, 0x63df8a, pulse);
      graphics.strokeCircle(mission.deliveryX, mission.deliveryY, mission.deliveryRadius);
    }
    const target = state.vehicles?.get(mission.targetVehicleId);
    if (!target) return;
    graphics.lineStyle(4, 0xf2c94c, pulse);
    graphics.strokeCircle(target.x, target.y, 34 + Math.sin(time / 130) * 3);
    graphics.lineBetween(target.x, target.y - 48, target.x - 8, target.y - 38);
    graphics.lineBetween(target.x, target.y - 48, target.x + 8, target.y - 38);
  }

  private updateMissionHud(): void {
    const hud = document.querySelector<HTMLElement>('#mission-hud');
    const action = document.querySelector<HTMLButtonElement>('#mission-action');
    const state = this.latestState;
    const local = state?.players?.get(this.room.sessionId);
    if (!hud || !action || !state || !local) return;

    const active = this.localMission();
    const joinable = !active ? this.joinableMission(local) : undefined;
    const nearContact = Math.hypot(
      local.x - state.missionContactX,
      local.y - state.missionContactY
    ) <= 130;
    if (!active && !joinable && !nearContact) {
      hud.classList.add('hidden');
      return;
    }
    hud.classList.remove('hidden');
    const mission = active ?? joinable;
    setElementText('#mission-title', mission ? 'BOOST AND DELIVER' : 'STREET CONTACT');
    setElementText('#mission-timer', mission ? formatMissionTime(mission.remainingMs) : 'AVAILABLE');
    setElementText('#mission-objective', mission
      ? missionObjective(mission, active !== undefined, this.room.sessionId)
      : 'Boost a marked traffic vehicle and deliver it intact.');
    setElementText('#mission-meta', mission
      ? `CREW ${mission.participants.size}/${mission.maximumParticipants} | $${mission.projectedReward}`
      : 'FREEMODE CREW WORK');

    action.classList.remove('hidden', 'warning');
    action.dataset.missionId = mission?.id ?? '';
    if (!mission) {
      action.dataset.action = 'start';
      action.textContent = 'START JOB';
    } else if (!active) {
      action.dataset.action = 'join';
      action.textContent = 'JOIN CREW';
    } else if (mission.phase === 'forming' && mission.leaderId === this.room.sessionId) {
      action.dataset.action = 'launch';
      action.textContent = 'LAUNCH';
    } else if (
      mission.leaderId === this.room.sessionId &&
      mission.phase !== 'completed' &&
      mission.phase !== 'failed'
    ) {
      action.dataset.action = 'abandon';
      action.textContent = 'ABANDON';
      action.classList.add('warning');
    } else {
      action.dataset.action = '';
      action.classList.add('hidden');
    }
  }

  private localMission(): NetworkMission | undefined {
    return [...(this.latestState?.missions?.values() ?? [])].find((mission) => (
      mission.participants?.has(this.room.sessionId)
    ));
  }

  private joinableMission(local: NetworkPlayer): NetworkMission | undefined {
    const state = this.latestState;
    if (!state) return undefined;
    return [...(state.missions?.values() ?? [])]
      .filter((mission) => (
        mission.phase === 'forming' &&
        mission.participants.size < mission.maximumParticipants
      ))
      .sort((left, right) => left.id.localeCompare(right.id))
      .find((mission) => {
        const leader = state.players?.get(mission.leaderId);
        return Boolean(leader && Math.hypot(local.x - leader.x, local.y - leader.y) <= 260);
      });
  }

  private setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    document.querySelector('#debug-panel')?.classList.toggle('hidden', !visible);
    const toggle = document.querySelector<HTMLButtonElement>('#debug-toggle');
    toggle?.setAttribute('aria-pressed', String(visible));
    const shell = document.querySelector<HTMLElement>('#game-shell');
    if (shell) shell.dataset.debug = visible ? 'visible' : 'hidden';

    if (visible) {
      this.lastDebugDrawAt = Number.NEGATIVE_INFINITY;
      this.updateDebugPanel();
      this.drawDebugWorld();
      return;
    }

    this.debugGraphics.clear();
    for (const label of this.debugLabels.values()) label.setVisible(false);
  }

  private drawDebugWorld(): void {
    const state = this.latestState;
    if (!state) return;
    const graphics = this.debugGraphics;
    const view = this.cameras.main.worldView;
    graphics.clear();

    graphics.fillStyle(0xff3652, 0.2);
    const minTileX = Math.max(0, Math.floor(view.left / this.tilemap.tileWidth) - 1);
    const maxTileX = Math.min(this.tilemap.width - 1, Math.ceil(view.right / this.tilemap.tileWidth) + 1);
    const minTileY = Math.max(0, Math.floor(view.top / this.tilemap.tileHeight) - 1);
    const maxTileY = Math.min(this.tilemap.height - 1, Math.ceil(view.bottom / this.tilemap.tileHeight) + 1);
    for (let row = minTileY; row <= maxTileY; row++) {
      for (let column = minTileX; column <= maxTileX; column++) {
        if (!this.collisionLayer.hasTileAt(column, row)) continue;
        graphics.fillRect(
          column * this.tilemap.tileWidth,
          row * this.tilemap.tileHeight,
          this.tilemap.tileWidth,
          this.tilemap.tileHeight
        );
      }
    }

    graphics.lineStyle(1, 0x70dcff, 0.34);
    const gridStartX = Math.floor(view.left / SPATIAL_CELL_SIZE) * SPATIAL_CELL_SIZE;
    const gridStartY = Math.floor(view.top / SPATIAL_CELL_SIZE) * SPATIAL_CELL_SIZE;
    for (let x = gridStartX; x <= view.right; x += SPATIAL_CELL_SIZE) {
      graphics.lineBetween(x, view.top, x, view.bottom);
    }
    for (let y = gridStartY; y <= view.bottom; y += SPATIAL_CELL_SIZE) {
      graphics.lineBetween(view.left, y, view.right, y);
    }

    const presentLabels = new Set<string>();
    state.players?.forEach((player, playerId) => {
      const key = `player:${playerId}`;
      const mode = player.vehicleId ? `seat:${player.vehicleSeat}` : 'foot';
      this.drawDebugEntity(
        player.x,
        player.y,
        PLAYER_RADIUS,
        player.angle,
        0x70dcff,
        key,
        `${player.name} p:${shortId(playerId)} ${mode} w:${player.wanted}`,
        presentLabels,
        player.alive
      );
    });
    state.npcs?.forEach((npc, npcId) => {
      const key = `npc:${npcId}`;
      const color = npc.kind === 'police' ? 0xff5e68 : 0xf4cf55;
      this.drawDebugEntity(
        npc.x,
        npc.y,
        NPC_RADIUS,
        npc.angle,
        color,
        key,
        `${npcId} hp:${npc.health}`,
        presentLabels,
        npc.alive
      );
    });
    state.vehicles?.forEach((vehicle, vehicleId) => {
      const key = `vehicle:${vehicleId}`;
      const mode = vehicle.traffic
        ? 'traffic'
        : (vehicle.driverId ? `driver:${shortId(vehicle.driverId)}` : 'idle');
      this.drawDebugEntity(
        vehicle.x,
        vehicle.y,
        VEHICLE_RADIUS,
        vehicle.angle,
        0x9d8bff,
        key,
        `${vehicleId} ${mode} hp:${vehicle.health}/${vehicle.maxHealth} eng:${vehicle.engineDamage} ` +
          `d:${vehicle.damageFront}/${vehicle.damageRear}/${vehicle.damageLeft}/${vehicle.damageRight} ` +
          `v:${Math.round(vehicle.speed)}${vehicle.onFire ? ' FIRE' : ''}${vehicle.destroyed ? ' WRECK' : ''}`,
        presentLabels,
        vehicle.health > 0
      );
    });
    state.bullets?.forEach((bullet) => {
      graphics.lineStyle(1, bullet.ownerKind === 'police' ? 0xff5e68 : 0xffffff, 1);
      graphics.strokeCircle(bullet.x, bullet.y, 6);
      graphics.lineBetween(
        bullet.x,
        bullet.y,
        bullet.x + Math.cos(bullet.angle) * 14,
        bullet.y + Math.sin(bullet.angle) * 14
      );
    });

    for (const incident of this.latestDebugSnapshot?.incidents ?? []) {
      const color = incident.status === 'reported' ? 0x777777 : 0xff9d3f;
      graphics.lineStyle(2, color, 0.95);
      graphics.strokeCircle(incident.x, incident.y, 18);
      graphics.lineBetween(incident.x - 7, incident.y - 7, incident.x + 7, incident.y + 7);
      graphics.lineBetween(incident.x + 7, incident.y - 7, incident.x - 7, incident.y + 7);
      const key = `incident:${incident.id}`;
      let label = this.debugLabels.get(key);
      const text = `${incident.id} ${incident.kind} ${incident.status}`;
      if (!label) {
        label = this.add.text(incident.x, incident.y - 22, text, {
          color: colorString(color),
          backgroundColor: 'rgba(0, 0, 0, 0.78)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '8px'
        }).setOrigin(0.5, 1).setDepth(990_000).setPadding(2, 1, 2, 1);
        this.debugLabels.set(key, label);
      }
      label.setPosition(incident.x, incident.y - 22).setText(text).setVisible(true);
      presentLabels.add(key);
    }

    for (const pursuit of this.latestDebugSnapshot?.pursuits ?? []) {
      const officer = state.npcs?.get(pursuit.officerId);
      if (!officer) continue;
      const color = pursuit.mode === 'pursuit' ? 0xff5e68 : 0x51f0b2;
      graphics.lineStyle(2, color, pursuit.mode === 'pursuit' ? 0.9 : 0.65);
      graphics.lineBetween(officer.x, officer.y, pursuit.lastKnownX, pursuit.lastKnownY);
      graphics.strokeCircle(pursuit.lastKnownX, pursuit.lastKnownY, pursuit.mode === 'pursuit' ? 9 : 24);
    }

    for (const [key, label] of this.debugLabels) {
      if (presentLabels.has(key)) continue;
      label.destroy();
      this.debugLabels.delete(key);
    }
  }

  private drawDebugEntity(
    x: number,
    y: number,
    radius: number,
    angle: number,
    color: number,
    key: string,
    text: string,
    presentLabels: Set<string>,
    active: boolean
  ): void {
    const alpha = active ? 0.95 : 0.38;
    this.debugGraphics.fillStyle(color, active ? 0.08 : 0.03);
    this.debugGraphics.fillCircle(x, y, radius);
    this.debugGraphics.lineStyle(1, color, alpha);
    this.debugGraphics.strokeCircle(x, y, radius);
    this.debugGraphics.lineBetween(
      x,
      y,
      x + Math.cos(angle) * (radius + 9),
      y + Math.sin(angle) * (radius + 9)
    );

    let label = this.debugLabels.get(key);
    if (!label) {
      label = this.add.text(x, y - radius - 4, text, {
        color: colorString(color),
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '8px'
      }).setOrigin(0.5, 1).setDepth(990_000).setPadding(2, 1, 2, 1);
      this.debugLabels.set(key, label);
    }
    label.setPosition(x, y - radius - 4).setText(text).setVisible(true).setAlpha(alpha);
    presentLabels.add(key);
  }

  private updateDebugPanel(): void {
    const snapshot = this.latestDebugSnapshot;
    const state = this.latestState;
    setDebugText('#debug-clock', snapshot
      ? `T${snapshot.tick} / ${(snapshot.nowMs / 1000).toFixed(1)}s`
      : 'Waiting');
    setDebugText('#debug-players', snapshot?.players ?? state?.players?.size ?? 0);
    setDebugText('#debug-npcs', snapshot?.npcs ?? state?.npcs?.size ?? 0);
    setDebugText('#debug-vehicles', snapshot?.vehicles ?? state?.vehicles?.size ?? 0);
    setDebugText('#debug-bullets', snapshot?.bullets ?? state?.bullets?.size ?? 0);
    setDebugText('#debug-spatial', snapshot?.spatialEntities ?? 0);
    setDebugText('#debug-dropped', `${Math.round(snapshot?.droppedMs ?? 0)}ms`);
    setDebugText('#debug-deferred', snapshot?.deferredCommands ?? 0);
    setDebugText('#debug-event-count', snapshot?.eventsThisTick ?? 0);
    setDebugText('#debug-incidents', snapshot?.incidents.length ?? 0);
    setDebugText('#debug-pursuits', snapshot?.pursuits.length ?? 0);

    const list = document.querySelector<HTMLOListElement>('#debug-events');
    if (!list) return;
    const events = snapshot?.events ?? [];
    if (events.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'No recent events';
      list.replaceChildren(item);
      return;
    }
    list.replaceChildren(...events.map((event) => {
      const item = document.createElement('li');
      item.textContent = `T${event.tick} ${event.summary}`;
      return item;
    }));
  }

  private updateHud(player: NetworkPlayer): void {
    const name = document.querySelector('#driver-name');
    const cash = document.querySelector('#cash');
    const healthFill = document.querySelector<HTMLElement>('#health-fill');
    const healthTrack = document.querySelector('#health-track');
    const heatMeter = document.querySelector('#heat-meter');
    const deathScreen = document.querySelector('#death-screen');
    const vehicleHud = document.querySelector('#vehicle-hud');
    const weaponHud = document.querySelector('#weapon-hud');
    const weaponName = document.querySelector('#weapon-name');
    const weaponAmmo = document.querySelector('#weapon-ammo');
    const weaponIcon = document.querySelector<HTMLImageElement>('#weapon-icon');
    const speedValue = document.querySelector('#speed-value');
    const vehicleCondition = document.querySelector<HTMLElement>('#vehicle-condition-fill');
    const vehicleConditionTrack = document.querySelector('#vehicle-condition');
    const shell = document.querySelector<HTMLElement>('#game-shell');

    if (name) name.textContent = player.name;
    if (cash) cash.textContent = `$${String(player.cash).padStart(6, '0')}`;
    if (healthFill) healthFill.style.width = `${clamp(player.health, 0, 100)}%`;
    healthTrack?.setAttribute('aria-label', `Health ${player.health}`);
    heatMeter?.setAttribute('aria-label', `Heat level ${player.wanted}`);
    document.querySelectorAll('#heat-meter i').forEach((cell, index) => {
      cell.classList.toggle('active', index < player.wanted);
    });
    deathScreen?.classList.toggle('hidden', player.alive);

    const vehicle = player.vehicleId ? this.latestState?.vehicles?.get(player.vehicleId) : undefined;
    const isDriver = Boolean(vehicle) && player.vehicleSeat === 0;
    vehicleHud?.classList.toggle('hidden', !isDriver);
    weaponHud?.classList.toggle('hidden', isDriver || !player.alive || Boolean(player.action));
    if (weaponName) weaponName.textContent = weaponLabel(player.weapon);
    if (weaponAmmo) weaponAmmo.textContent = String(playerAmmo(player));
    if (weaponIcon) {
      weaponIcon.src = `/assets/original/weapons/${player.weapon}.svg`;
      weaponIcon.alt = player.weapon;
    }
    if (speedValue) speedValue.textContent = String(Math.round(Math.abs(vehicle?.speed ?? 0) * 0.55)).padStart(3, '0');
    if (vehicleCondition) {
      vehicleCondition.style.width = `${clamp(
        (vehicle?.health ?? 0) / Math.max(1, vehicle?.maxHealth ?? 1) * 100,
        0,
        100
      )}%`;
    }
    vehicleConditionTrack?.setAttribute('aria-label', `Vehicle condition ${vehicle?.health ?? 0}`);
    if (shell) {
      shell.dataset.mode = vehicle ? 'vehicle' : (player.alive ? 'foot' : 'dead');
      shell.dataset.health = String(player.health);
      shell.dataset.wanted = String(player.wanted);
      shell.dataset.action = player.action;
    }

    if (player.wanted > this.lastWanted) this.showToast(player.wanted >= 3 ? 'POLICE ESCALATION' : 'WANTED');
    if (player.wanted === 0 && this.lastWanted > 0) this.showToast('HEAT LOST');
    if (player.cash > this.lastCash) this.showToast(`+$${player.cash - this.lastCash}`);
    if (player.action === 'hijacking' && player.action !== this.lastLocalAction) this.showToast('CARJACKING');
    if (player.action === 'entering' && player.action !== this.lastLocalAction) this.showToast('ENTERING');
    this.lastWanted = player.wanted;
    this.lastCash = player.cash;
    this.lastLocalAction = player.action;
  }

  private showToast(message: string, tone: MissionNotice['tone'] = 'info'): void {
    const element = document.querySelector('#event-toast');
    if (!element) return;
    element.textContent = message;
    element.setAttribute('data-tone', tone);
    element.classList.add('visible');
    if (this.toastTimeout) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => element.classList.remove('visible'), 1300);
  }

  private setConnectionState(online: boolean): void {
    const element = document.querySelector('#connection-state');
    if (!element) return;
    element.textContent = online ? 'Online' : 'Disconnected';
    element.classList.toggle('offline', !online);
  }
}

function weaponLabel(weapon: NetworkPlayer['weapon']): string {
  return weapon === 'smg' ? 'SMG' : weapon.toUpperCase();
}

function playerAmmo(player: NetworkPlayer): number {
  if (player.weapon === 'smg') return player.ammoSmg;
  if (player.weapon === 'shotgun') return player.ammoShotgun;
  return player.ammoPistol;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shortId(id: string): string {
  return id.length <= 6 ? id : id.slice(0, 6);
}

function colorString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function setDebugText(selector: string, value: string | number): void {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value);
}

function setElementText(selector: string, value: string): void {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function formatMissionTime(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function missionObjective(
  mission: NetworkMission,
  isParticipant: boolean,
  localPlayerId: string
): string {
  if (mission.phase === 'forming') {
    if (!isParticipant) {
      const leader = mission.participants.get(mission.leaderId)?.name ?? 'A nearby driver';
      return `${leader} is forming a crew.`;
    }
    return mission.leaderId === localPlayerId
      ? 'Crew forming. Launch now or wait for nearby drivers.'
      : 'Crew ready. Waiting for the leader to launch.';
  }
  if (mission.phase === 'steal') return 'Steal the marked traffic vehicle.';
  if (mission.phase === 'lose-heat') return 'Lose all crew police heat.';
  if (mission.phase === 'deliver') return 'Bring the target into the green delivery zone at low speed.';
  if (mission.phase === 'completed') return `Job complete. Crew paid $${mission.finalReward} each.`;
  if (mission.failureReason === 'target-destroyed') return 'Job failed. The target was destroyed.';
  if (mission.failureReason === 'time-expired') return 'Job failed. Time expired.';
  if (mission.failureReason === 'all-participants-disconnected') return 'Job failed. The crew disconnected.';
  return 'Job abandoned.';
}

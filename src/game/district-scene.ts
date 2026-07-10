import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import {
  DEBUG_SNAPSHOT_MESSAGE,
  type DebugSnapshot
} from '../../shared/protocol/debug.ts';
import {
  MISSION_ABANDON_MESSAGE,
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_NOTICE_MESSAGE,
  MISSION_START_MESSAGE,
  type MissionNotice
} from '../../shared/protocol/missions.ts';
import {TouchControls} from './touch-controls.ts';
import {buildMinimapFrame} from './minimap-marker-policy.ts';
import type {MinimapPointInput} from './minimap-marker-policy.ts';
import {MinimapRenderer} from './minimap-renderer.ts';
import type {
  DistrictNetworkState,
  NetworkBullet,
  NetworkNpc,
  NetworkMission,
  NetworkPlayer,
  NetworkVehicle
} from './types.ts';

const PLAYER_SPEED = 190;
const PLAYER_RADIUS = 11;
const INPUT_SEND_INTERVAL = 50;
const INPUT_HEARTBEAT = 220;
const AIM_SEND_INTERVAL = 45;
const FIRE_INTERVAL = 45;
const WEAPON_CYCLE_INTERVAL = 120;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const SPATIAL_CELL_SIZE = 256;
const DEBUG_DRAW_INTERVAL = 100;

interface RenderPlayer {
  sprite: Phaser.GameObjects.Sprite;
  passengerSprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  weaponSprite: Phaser.GameObjects.Image;
  weapon: NetworkPlayer['weapon'];
  targetX: number;
  targetY: number;
  targetAngle: number;
  isLocal: boolean;
  peekRecoilUntil: number;
}

interface RenderNpc {
  sprite: Phaser.GameObjects.Sprite;
  targetX: number;
  targetY: number;
  targetAngle: number;
}

interface RenderVehicle {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  smoke: Phaser.GameObjects.Arc;
  fire: Phaser.GameObjects.Arc;
  redLight?: Phaser.GameObjects.Arc;
  blueLight?: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
  targetAngle: number;
  localDriver: boolean;
  localOccupant: boolean;
}

interface RenderBullet {
  circle: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
}

export class DistrictScene extends Phaser.Scene {
  private readonly room: Room<DistrictNetworkState>;
  private readonly players = new Map<string, RenderPlayer>();
  private readonly npcs = new Map<string, RenderNpc>();
  private readonly vehicles = new Map<string, RenderVehicle>();
  private readonly bullets = new Map<string, RenderBullet>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private previousWeaponKey!: Phaser.Input.Keyboard.Key;
  private nextWeaponKey!: Phaser.Input.Keyboard.Key;
  private debugKey!: Phaser.Input.Keyboard.Key;
  private tilemap!: Phaser.Tilemaps.Tilemap;
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;
  private crosshair!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private missionGraphics!: Phaser.GameObjects.Graphics;
  private readonly debugLabels = new Map<string, Phaser.GameObjects.Text>();
  private touchControls!: TouchControls;
  private minimap?: MinimapRenderer;
  private lastInputX = 0;
  private lastInputY = 0;
  private lastInputSentAt = 0;
  private lastAimSentAt = 0;
  private lastFireAt = 0;
  private lastWeaponCycleAt = 0;
  private lastLocalHealth = 100;
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
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.previousWeaponKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.nextWeaponKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.debugKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F3);
    this.touchControls = new TouchControls();
    this.input.on('wheel', (_pointer: unknown, _objects: unknown, _deltaX: number, deltaY: number) => {
      if (Math.abs(deltaY) > 1) this.cycleWeapon(deltaY > 0 ? 1 : -1);
    });
    document.querySelector('#weapon-prev')?.addEventListener('click', () => this.cycleWeapon(-1));
    document.querySelector('#weapon-next')?.addEventListener('click', () => this.cycleWeapon(1));
    document.querySelector('#vehicle-action-button')?.addEventListener('click', () => {
      this.room.send('interact');
    });
    document.querySelector('#debug-toggle')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setDebugVisible(!this.debugVisible);
    });
    document.querySelector('#mission-action')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.activateMissionAction();
    });

    this.debugGraphics = this.add.graphics().setDepth(980_000);
    this.missionGraphics = this.add.graphics().setDepth(870_000);
    this.crosshair = this.add.graphics().setScrollFactor(0).setDepth(1_000_000);
    this.room.onMessage<DebugSnapshot>(DEBUG_SNAPSHOT_MESSAGE, (snapshot) => {
      this.latestDebugSnapshot = snapshot;
      this.updateDebugPanel();
    });
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
    const input = this.readMovementInput();
    this.sendMovement(input.x, input.y, time);
    this.predictLocalMovement(input.x, input.y, delta / 1000);
    this.updateAim(time);
    this.updateShooting(time);
    this.updateInteraction();
    this.updateWeaponCycling(time);
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
    const presentPlayers = new Set<string>();
    state.players?.forEach((player, playerId) => {
      presentPlayers.add(playerId);
      this.synchronizePlayer(playerId, player);
    });
    for (const [playerId, rendered] of this.players) {
      if (presentPlayers.has(playerId)) continue;
      rendered.sprite.destroy();
      rendered.passengerSprite.destroy();
      rendered.label.destroy();
      rendered.weaponSprite.destroy();
      this.players.delete(playerId);
    }

    const presentNpcs = new Set<string>();
    state.npcs?.forEach((npc, npcId) => {
      presentNpcs.add(npcId);
      this.synchronizeNpc(npcId, npc);
    });
    for (const [npcId, rendered] of this.npcs) {
      if (presentNpcs.has(npcId)) continue;
      rendered.sprite.destroy();
      this.npcs.delete(npcId);
    }

    const presentVehicles = new Set<string>();
    state.vehicles?.forEach((vehicle, vehicleId) => {
      presentVehicles.add(vehicleId);
      this.synchronizeVehicle(vehicleId, vehicle);
    });
    for (const [vehicleId, rendered] of this.vehicles) {
      if (presentVehicles.has(vehicleId)) continue;
      rendered.container.destroy(true);
      this.vehicles.delete(vehicleId);
    }

    const presentBullets = new Set<string>();
    state.bullets?.forEach((bullet, bulletId) => {
      presentBullets.add(bulletId);
      this.synchronizeBullet(bulletId, bullet);
    });
    for (const [bulletId, rendered] of this.bullets) {
      if (presentBullets.has(bulletId)) continue;
      rendered.circle.destroy();
      this.bullets.delete(bulletId);
    }
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

  private synchronizePlayer(playerId: string, player: NetworkPlayer): void {
    let rendered = this.players.get(playerId);
    const isLocal = playerId === this.room.sessionId;
    if (!rendered) {
      const sprite = this.add.sprite(player.x, player.y, 'driver', 0)
        .setDisplaySize(72, 72)
        .setOrigin(0.5)
        .setDepth(Math.round(player.y) + 100);
      const label = this.add.text(player.x, player.y - 31, player.name, {
        color: '#ffffff',
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0.5, 1).setDepth(950_000);
      const weaponSprite = this.add.image(player.x, player.y, weaponTexture(player.weapon))
        .setOrigin(0.16, 0.5)
        .setDepth(Math.round(player.y) + 101);
      sizeWeaponSprite(weaponSprite, player.weapon);
      const passengerSprite = this.add.sprite(player.x, player.y, 'driver', 0)
        .setOrigin(0.5)
        .setScale(0.58)
        .setVisible(false)
        .setDepth(Math.round(player.y) + 101);
      rendered = {
        sprite,
        passengerSprite,
        label,
        weaponSprite,
        weapon: player.weapon,
        targetX: player.x,
        targetY: player.y,
        targetAngle: player.angle,
        isLocal,
        peekRecoilUntil: 0
      };
      this.players.set(playerId, rendered);
    }

    rendered.targetX = player.x;
    rendered.targetY = player.y;
    rendered.targetAngle = player.angle;
    const visibleOnFoot = player.alive && !player.vehicleId;
    const visiblePassengerWeapon = player.alive && Boolean(player.vehicleId) && player.vehicleSeat > 0;
    rendered.sprite.setVisible(visibleOnFoot);
    rendered.passengerSprite.setVisible(visiblePassengerWeapon && !player.action);
    rendered.label.setVisible(player.alive).setText(player.name);
    rendered.weaponSprite.setVisible((visibleOnFoot || visiblePassengerWeapon) && !player.action);
    if (rendered.weapon !== player.weapon) {
      rendered.weapon = player.weapon;
      rendered.weaponSprite.setTexture(weaponTexture(player.weapon));
      sizeWeaponSprite(rendered.weaponSprite, player.weapon);
    }

    if (isLocal) {
      this.updateHud(player);
      if (!player.vehicleId && this.cameraTargetId !== `player:${playerId}`) {
        this.cameras.main.startFollow(rendered.sprite, true, 0.14, 0.14);
        this.cameras.main.centerOn(player.x, player.y);
        this.cameraTargetId = `player:${playerId}`;
      }
      if (player.health < this.lastLocalHealth) {
        this.cameras.main.shake(110, 0.004);
        this.cameras.main.flash(90, 150, 20, 20, false);
      }
      this.lastLocalHealth = player.health;
    }
  }

  private synchronizeNpc(npcId: string, npc: NetworkNpc): void {
    let rendered = this.npcs.get(npcId);
    if (!rendered) {
      const sprite = this.add.sprite(npc.x, npc.y, npc.kind, 0)
        .setDisplaySize(72, 72)
        .setOrigin(0.5)
        .setDepth(Math.round(npc.y) + 95);
      rendered = {sprite, targetX: npc.x, targetY: npc.y, targetAngle: npc.angle};
      this.npcs.set(npcId, rendered);
    }
    rendered.targetX = npc.x;
    rendered.targetY = npc.y;
    rendered.targetAngle = npc.angle;
    rendered.sprite.setVisible(npc.alive);
  }

  private synchronizeVehicle(vehicleId: string, vehicle: NetworkVehicle): void {
    let rendered = this.vehicles.get(vehicleId);
    const localDriver = vehicle.driverId === this.room.sessionId;
    const localOccupant = this.latestState?.players?.get(this.room.sessionId)?.vehicleId === vehicleId;
    if (!rendered) {
      const sprite = this.add.sprite(0, 0, 'vehicles', vehicleFrame(vehicle.kind)).setDisplaySize(96, 96);
      const smoke = this.add.circle(0, -17, 6, 0x2d3436, 0.75).setStrokeStyle(2, 0x9aa2a4, 0.5);
      const fire = this.add.circle(0, -14, 4, 0xff8c24, 0.95).setStrokeStyle(2, 0xffd34d, 0.9);
      smoke.setVisible(false);
      fire.setVisible(false);
      const children: Phaser.GameObjects.GameObject[] = [sprite, smoke, fire];
      let redLight: Phaser.GameObjects.Arc | undefined;
      let blueLight: Phaser.GameObjects.Arc | undefined;
      if (vehicle.kind === 'police') {
        redLight = this.add.circle(-8, 0, 2.6, 0xff3030, 1)
          .setStrokeStyle(1.5, 0xff8a8a, 0.7);
        blueLight = this.add.circle(8, 0, 2.6, 0x3c73ff, 1)
          .setStrokeStyle(1.5, 0x8eb0ff, 0.7);
        children.push(redLight, blueLight);
      }
      const container = this.add.container(vehicle.x, vehicle.y, children)
        .setDepth(Math.round(vehicle.y) + 90);
      rendered = {
        container,
        sprite,
        smoke,
        fire,
        redLight,
        blueLight,
        targetX: vehicle.x,
        targetY: vehicle.y,
        targetAngle: vehicle.angle,
        localDriver,
        localOccupant
      };
      this.vehicles.set(vehicleId, rendered);
    }
    rendered.targetX = vehicle.x;
    rendered.targetY = vehicle.y;
    rendered.targetAngle = vehicle.angle;
    rendered.localDriver = localDriver;
    rendered.localOccupant = localOccupant;
    rendered.sprite.setFrame(vehicleFrame(vehicle.kind));
    const healthRatio = clamp(vehicle.health / Math.max(1, vehicle.maxHealth), 0, 1);
    rendered.smoke.setVisible(vehicle.destroyed || vehicle.engineDamage >= 100);
    rendered.fire.setVisible(vehicle.destroyed || vehicle.onFire);
    rendered.sprite.setAlpha(vehicle.destroyed ? 0.68 : 1);
    if (vehicle.destroyed) rendered.sprite.setTint(0x4f4f4f);
    else if (healthRatio < 0.35) rendered.sprite.setTint(0xc77b68);
    else rendered.sprite.clearTint();
    if (localOccupant && this.cameraTargetId !== `vehicle:${vehicleId}`) {
      this.cameras.main.startFollow(rendered.container, true, 0.12, 0.12);
      this.cameraTargetId = `vehicle:${vehicleId}`;
    }
  }

  private synchronizeBullet(bulletId: string, bullet: NetworkBullet): void {
    let rendered = this.bullets.get(bulletId);
    if (!rendered) {
      const style = bulletStyle(bullet);
      const color = bullet.ownerKind === 'police' ? 0xff6262 : style.color;
      const circle = this.add.circle(bullet.x, bullet.y, style.radius, color, 1)
        .setStrokeStyle(1, 0xffffff, 0.8)
        .setDepth(900_000);
      rendered = {circle, targetX: bullet.x, targetY: bullet.y};
      this.bullets.set(bulletId, rendered);
      const shooter = this.players.get(bullet.ownerId);
      const shooterState = this.latestState?.players?.get(bullet.ownerId);
      if (shooter && shooterState?.vehicleId && shooterState.vehicleSeat > 0) {
        shooter.peekRecoilUntil = this.time.now + 140;
      }
      const flash = this.add.circle(bullet.x, bullet.y, 9, color, 0.68).setDepth(899_999);
      this.tweens.add({targets: flash, alpha: 0, scale: 1.8, duration: 90, onComplete: () => flash.destroy()});
    }
    rendered.targetX = bullet.x;
    rendered.targetY = bullet.y;
  }

  private readMovementInput(): {x: number; y: number} {
    let x = this.touchControls?.movement.x ?? 0;
    let y = this.touchControls?.movement.y ?? 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) x -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) x += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) y -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) y += 1;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }
    return {x, y};
  }

  private sendMovement(x: number, y: number, time: number): void {
    const changed = Math.abs(x - this.lastInputX) > 0.015 || Math.abs(y - this.lastInputY) > 0.015;
    if ((changed && time - this.lastInputSentAt >= INPUT_SEND_INTERVAL) || time - this.lastInputSentAt >= INPUT_HEARTBEAT) {
      this.room.send('input', {x, y});
      this.lastInputX = x;
      this.lastInputY = y;
      this.lastInputSentAt = time;
    }
  }

  private predictLocalMovement(x: number, y: number, deltaSeconds: number): void {
    const localState = this.latestState?.players?.get(this.room.sessionId);
    const local = this.players.get(this.room.sessionId);
    if (!local || !localState?.alive || localState.vehicleId || localState.action) return;
    const distance = PLAYER_SPEED * Math.min(deltaSeconds, 0.05);
    if (x !== 0 || y !== 0) {
      local.sprite.play('driver-walk', true);
    } else if (local.sprite.anims.isPlaying) {
      local.sprite.stop().setFrame(0);
    }
    const nextX = local.sprite.x + x * distance;
    if (this.canOccupy(nextX, local.sprite.y)) local.sprite.x = nextX;
    const nextY = local.sprite.y + y * distance;
    if (this.canOccupy(local.sprite.x, nextY)) local.sprite.y = nextY;
  }

  private updateAim(time: number): void {
    const playerState = this.latestState?.players?.get(this.room.sessionId);
    const local = this.players.get(this.room.sessionId);
    if (
      !local ||
      !playerState?.alive ||
      (playerState.vehicleId && playerState.vehicleSeat === 0) ||
      playerState.action
    ) return;

    let angle: number;
    if (this.touchControls.active || this.touchControls.firing) {
      angle = Math.atan2(this.touchControls.aim.y, this.touchControls.aim.x);
    } else {
      const worldPointer = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      angle = Phaser.Math.Angle.Between(local.sprite.x, local.sprite.y, worldPointer.x, worldPointer.y);
    }
    local.sprite.rotation = angle - Math.PI / 2;
    local.targetAngle = angle;
    if (time - this.lastAimSentAt >= AIM_SEND_INTERVAL) {
      this.room.send('aim', {angle});
      this.lastAimSentAt = time;
    }
  }

  private updateShooting(time: number): void {
    const player = this.latestState?.players?.get(this.room.sessionId);
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0) || player.action) return;
    const pointerEvent = this.input.activePointer.event as PointerEvent | undefined;
    const firing = this.touchControls.firing || (
      this.input.activePointer.isDown && pointerEvent?.pointerType !== 'touch'
    );
    if (firing && time - this.lastFireAt >= FIRE_INTERVAL) {
      this.room.send('shoot');
      this.lastFireAt = time;
    }
  }

  private updateInteraction(): void {
    if (Phaser.Input.Keyboard.JustDown(this.interactKey) || this.touchControls.consumeInteract()) {
      this.room.send('interact');
    }
  }

  private activateMissionAction(): void {
    const button = document.querySelector<HTMLButtonElement>('#mission-action');
    const action = button?.dataset.action;
    const missionId = button?.dataset.missionId ?? '';
    if (action === 'start') this.room.send(MISSION_START_MESSAGE);
    else if (action === 'join') this.room.send(MISSION_JOIN_MESSAGE, {missionId});
    else if (action === 'launch') this.room.send(MISSION_LAUNCH_MESSAGE, {missionId});
    else if (action === 'abandon') this.room.send(MISSION_ABANDON_MESSAGE, {missionId});
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

  private updateWeaponCycling(time: number): void {
    if (time - this.lastWeaponCycleAt < WEAPON_CYCLE_INTERVAL) return;
    if (Phaser.Input.Keyboard.JustDown(this.previousWeaponKey)) this.cycleWeapon(-1);
    else if (Phaser.Input.Keyboard.JustDown(this.nextWeaponKey)) this.cycleWeapon(1);
  }

  private cycleWeapon(direction: -1 | 1): void {
    const player = this.latestState?.players?.get(this.room.sessionId);
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0) || player.action) return;
    this.room.send('cycleWeapon', {direction});
    this.lastWeaponCycleAt = this.time.now;
  }

  private interpolateEntities(time: number): void {
    for (const [playerId, rendered] of this.players) {
      const playerState = this.latestState?.players?.get(playerId);
      const distance = Phaser.Math.Distance.Between(
        rendered.sprite.x,
        rendered.sprite.y,
        rendered.targetX,
        rendered.targetY
      );
      if (distance > 120) {
        rendered.sprite.setPosition(rendered.targetX, rendered.targetY);
      } else {
        const correction = rendered.isLocal ? 0.08 : 0.24;
        rendered.sprite.x = Phaser.Math.Linear(rendered.sprite.x, rendered.targetX, correction);
        rendered.sprite.y = Phaser.Math.Linear(rendered.sprite.y, rendered.targetY, correction);
      }
      if (!rendered.isLocal) {
        rendered.sprite.rotation = Phaser.Math.Angle.RotateTo(
          rendered.sprite.rotation,
          rendered.targetAngle - Math.PI / 2,
          0.16
        );
        this.updateWalkAnimation(rendered.sprite, 'driver-walk', distance);
      }
      rendered.sprite.setDepth(Math.round(rendered.sprite.y) + 100);
      if (playerState?.action) {
        const pulse = 1 + Math.sin(time / 58) * 0.08;
        rendered.sprite.setScale(pulse);
        rendered.sprite.rotation = rendered.targetAngle - Math.PI / 2 + Math.sin(time / 42) * 0.16;
      } else {
        rendered.sprite.setScale(1);
      }
      const aimAngle = rendered.isLocal ? rendered.targetAngle : rendered.sprite.rotation + Math.PI / 2;
      let weaponBaseX = rendered.sprite.x;
      let weaponBaseY = rendered.sprite.y;
      if (playerState?.vehicleId && playerState.vehicleSeat > 0) {
        const vehicle = this.vehicles.get(playerState.vehicleId);
        if (vehicle) {
          const forwardOffset = playerState.vehicleSeat === 3 ? -11 : 5;
          const sideOffset = playerState.vehicleSeat === 1 ? 15 : (playerState.vehicleSeat === 2 ? -15 : 0);
          const sideAngle = vehicle.targetAngle + Math.PI / 2;
          weaponBaseX = vehicle.container.x + Math.cos(vehicle.targetAngle) * forwardOffset +
            Math.cos(sideAngle) * sideOffset;
          weaponBaseY = vehicle.container.y + Math.sin(vehicle.targetAngle) * forwardOffset +
            Math.sin(sideAngle) * sideOffset;
          const recoil = time < rendered.peekRecoilUntil ? 4 : 0;
          const peek = 3 + Math.sin(time / 95 + playerState.vehicleSeat) * 1.4;
          const peekAngle = playerState.vehicleSeat === 3
            ? vehicle.targetAngle + Math.PI
            : sideAngle + (sideOffset < 0 ? Math.PI : 0);
          rendered.passengerSprite
            .setPosition(
              weaponBaseX + Math.cos(peekAngle) * peek - Math.cos(aimAngle) * recoil,
              weaponBaseY + Math.sin(peekAngle) * peek - Math.sin(aimAngle) * recoil
            )
            .setRotation(aimAngle - Math.PI / 2)
            .setScale(time < rendered.peekRecoilUntil ? 0.64 : 0.58)
            .setDepth(Math.round(weaponBaseY) + 101);
        }
      }
      rendered.weaponSprite
        .setPosition(
          weaponBaseX + Math.cos(aimAngle) * 7,
          weaponBaseY + Math.sin(aimAngle) * 7
        )
        .setRotation(aimAngle)
        .setDepth(Math.round(weaponBaseY) + 102);
      if (playerState?.vehicleId) {
        const vehicle = this.vehicles.get(playerState.vehicleId);
        if (vehicle) {
          rendered.label.setPosition(
            vehicle.container.x,
            vehicle.container.y - 34 - Math.max(0, playerState.vehicleSeat) * 12
          );
        }
      } else {
        rendered.label.setPosition(rendered.sprite.x, rendered.sprite.y - 31);
      }
    }
    this.resolveNameplateOverlaps();

    for (const rendered of this.npcs.values()) {
      const distance = Phaser.Math.Distance.Between(
        rendered.sprite.x,
        rendered.sprite.y,
        rendered.targetX,
        rendered.targetY
      );
      if (distance > 120) {
        rendered.sprite.setPosition(rendered.targetX, rendered.targetY);
      } else {
        rendered.sprite.x = Phaser.Math.Linear(rendered.sprite.x, rendered.targetX, 0.22);
        rendered.sprite.y = Phaser.Math.Linear(rendered.sprite.y, rendered.targetY, 0.22);
      }
      rendered.sprite.rotation = Phaser.Math.Angle.RotateTo(
        rendered.sprite.rotation,
        rendered.targetAngle - Math.PI / 2,
        0.14
      );
      this.updateWalkAnimation(rendered.sprite, `${rendered.sprite.texture.key}-walk`, distance);
      rendered.sprite.setDepth(Math.round(rendered.sprite.y) + 95);
    }

    for (const rendered of this.vehicles.values()) {
      const distance = Phaser.Math.Distance.Between(
        rendered.container.x,
        rendered.container.y,
        rendered.targetX,
        rendered.targetY
      );
      const correction = rendered.localOccupant ? 0.34 : 0.25;
      if (distance > 180) {
        rendered.container.setPosition(rendered.targetX, rendered.targetY);
      } else {
        rendered.container.x = Phaser.Math.Linear(rendered.container.x, rendered.targetX, correction);
        rendered.container.y = Phaser.Math.Linear(rendered.container.y, rendered.targetY, correction);
      }
      rendered.container.rotation = Phaser.Math.Angle.RotateTo(
        rendered.container.rotation,
        rendered.targetAngle + Math.PI / 2,
        0.2
      );
      rendered.container.setDepth(Math.round(rendered.container.y) + 90);
      if (rendered.redLight && rendered.blueLight) {
        const phase = Math.floor(time / 120) % 2;
        rendered.redLight.alpha = phase === 0 ? 1 : 0.22;
        rendered.blueLight.alpha = phase === 1 ? 1 : 0.22;
      }
      if (rendered.smoke.visible) {
        rendered.smoke.setPosition(Math.sin(time / 180) * 2.5, -17 - Math.sin(time / 110) * 3);
        rendered.smoke.setScale(0.85 + (Math.sin(time / 140) + 1) * 0.18);
        rendered.smoke.alpha = 0.45 + (Math.sin(time / 170) + 1) * 0.16;
      }
      if (rendered.fire.visible) {
        rendered.fire.setScale(0.78 + (Math.sin(time / 52) + 1) * 0.22);
      }
    }

    for (const rendered of this.bullets.values()) {
      rendered.circle.x = Phaser.Math.Linear(rendered.circle.x, rendered.targetX, 0.62);
      rendered.circle.y = Phaser.Math.Linear(rendered.circle.y, rendered.targetY, 0.62);
    }
  }

  private updateWalkAnimation(sprite: Phaser.GameObjects.Sprite, key: string, distance: number): void {
    if (!sprite.visible) return;
    if (distance > 0.75) {
      sprite.play(key, true);
    } else if (sprite.anims.isPlaying) {
      sprite.stop().setFrame(0);
    }
  }

  private resolveNameplateOverlaps(): void {
    const placed: Array<{x: number; y: number}> = [];
    const labels = [...this.players.values()]
      .map((rendered) => rendered.label)
      .filter((label) => label.visible)
      .sort((left, right) => left.y - right.y || left.x - right.x);
    for (const label of labels) {
      let y = label.y;
      while (placed.some((position) => Math.abs(position.x - label.x) < 54 && Math.abs(position.y - y) < 11)) {
        y -= 12;
      }
      label.y = y;
      placed.push({x: label.x, y});
    }
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
    if (this.touchControls.active || this.touchControls.firing) return;
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

function vehicleFrame(kind: NetworkVehicle['kind']): number {
  if (kind === 'police') return 1;
  if (kind === 'taxi') return 2;
  return 0;
}

function weaponTexture(weapon: NetworkPlayer['weapon']): string {
  return `weapon-${weapon}`;
}

function sizeWeaponSprite(sprite: Phaser.GameObjects.Image, weapon: NetworkPlayer['weapon']): void {
  if (weapon === 'shotgun') sprite.setDisplaySize(42, 10);
  else if (weapon === 'smg') sprite.setDisplaySize(33, 11);
  else sprite.setDisplaySize(25, 9);
}

function weaponLabel(weapon: NetworkPlayer['weapon']): string {
  return weapon === 'smg' ? 'SMG' : weapon.toUpperCase();
}

function playerAmmo(player: NetworkPlayer): number {
  if (player.weapon === 'smg') return player.ammoSmg;
  if (player.weapon === 'shotgun') return player.ammoShotgun;
  return player.ammoPistol;
}

function bulletStyle(bullet: NetworkBullet): {color: number; radius: number} {
  if (bullet.weapon === 'smg') return {color: 0xff9f43, radius: 2.5};
  if (bullet.weapon === 'shotgun') return {color: 0xffe8a3, radius: 3.5};
  return {color: 0xffdc55, radius: 3.2};
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

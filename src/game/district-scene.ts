import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import {TouchControls} from './touch-controls.ts';
import type {
  DistrictNetworkState,
  NetworkBullet,
  NetworkNpc,
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
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;
  private crosshair!: Phaser.GameObjects.Graphics;
  private touchControls!: TouchControls;
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

  constructor(room: Room<DistrictNetworkState>) {
    super('district');
    this.room = room;
  }

  preload(): void {
    this.load.tilemapTiledJSON('district-map', '/assets/maps/district-map.json');
    this.load.image('district-tiles', '/assets/maps/district-tiles.png');
    this.load.image('district-preview', '/assets/maps/district-preview.png');
    this.load.image('district-overlay', '/assets/maps/district-overlay.png');
    this.load.spritesheet('driver', '/assets/custom/sprites/player-base.png', {
      frameWidth: 72,
      frameHeight: 72
    });
    this.load.spritesheet('civilian', '/assets/custom/sprites/civilian.png', {
      frameWidth: 72,
      frameHeight: 72
    });
    this.load.spritesheet('police', '/assets/custom/sprites/police.png', {
      frameWidth: 72,
      frameHeight: 72
    });
    this.load.spritesheet('vehicles', '/assets/custom/sprites/vehicles.png', {
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
    this.touchControls = new TouchControls();
    this.input.on('wheel', (_pointer: unknown, _objects: unknown, _deltaX: number, deltaY: number) => {
      if (Math.abs(deltaY) > 1) this.cycleWeapon(deltaY > 0 ? 1 : -1);
    });
    document.querySelector('#weapon-prev')?.addEventListener('click', () => this.cycleWeapon(-1));
    document.querySelector('#weapon-next')?.addEventListener('click', () => this.cycleWeapon(1));
    document.querySelector('#vehicle-action-button')?.addEventListener('click', () => {
      this.room.send('interact');
    });

    this.crosshair = this.add.graphics().setScrollFactor(0).setDepth(1_000_000);
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
    this.drawCrosshair();
  }

  private createPedestrianAnimation(key: string, texture: string): void {
    this.anims.create({
      key,
      frames: this.anims.generateFrameNumbers(texture, {start: 1, end: 8}),
      frameRate: 16,
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
      const children: Phaser.GameObjects.GameObject[] = [sprite];
      let redLight: Phaser.GameObjects.Arc | undefined;
      let blueLight: Phaser.GameObjects.Arc | undefined;
      if (vehicle.kind === 'police') {
        redLight = this.add.circle(-5, -8, 2.2, 0xff3030, 1);
        blueLight = this.add.circle(5, -8, 2.2, 0x3c73ff, 1);
        children.push(redLight, blueLight);
      }
      const container = this.add.container(vehicle.x, vehicle.y, children)
        .setDepth(Math.round(vehicle.y) + 90);
      rendered = {
        container,
        sprite,
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

  private showToast(message: string): void {
    const element = document.querySelector('#event-toast');
    if (!element) return;
    element.textContent = message;
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

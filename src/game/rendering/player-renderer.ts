import Phaser from 'phaser';
import type {NetworkPlayer} from '../types.ts';
import {interpolatePosition, rotateTowards} from './interpolation-policy.ts';
import {passengerPresentation, weaponPresentation} from './player-render-policy.ts';
import type {VehicleRenderPose} from './render-types.ts';
import {PlayerAppearanceTextureFactory} from '../appearance/player-appearance-texture-factory.ts';

const PLAYER_SPEED = 190;

interface RenderPlayer {
  sprite: Phaser.GameObjects.Sprite;
  passengerSprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  weaponSprite: Phaser.GameObjects.Image;
  weapon: NetworkPlayer['weapon'];
  appearanceTextureKey: string;
  animationKey: string;
  bodyScaleX: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
  isLocal: boolean;
  peekRecoilUntil: number;
}

interface PlayerRendererOptions {
  localPlayerId: string;
  vehiclePose: (vehicleId: string) => VehicleRenderPose | undefined;
  canOccupy: (x: number, y: number) => boolean;
  onLocalState: (
    playerId: string,
    player: NetworkPlayer,
    sprite: Phaser.GameObjects.Sprite,
    damaged: boolean
  ) => void;
}

export class PlayerRenderer {
  private readonly rendered = new Map<string, RenderPlayer>();
  private latestPlayers?: Map<string, NetworkPlayer>;
  private lastLocalHealth = 100;
  private readonly appearances: PlayerAppearanceTextureFactory;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: PlayerRendererOptions
  ) {
    this.appearances = new PlayerAppearanceTextureFactory(scene);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(players?: Map<string, NetworkPlayer>): void {
    this.latestPlayers = players;
    const present = new Set<string>();
    players?.forEach((player, playerId) => {
      present.add(playerId);
      this.synchronizeOne(playerId, player);
    });
    for (const [playerId, rendered] of this.rendered) {
      if (present.has(playerId)) continue;
      destroyPlayer(rendered);
      this.rendered.delete(playerId);
    }
    this.appearances.prune(new Set(
      [...this.rendered.values()].map((rendered) => rendered.appearanceTextureKey)
    ));
  }

  interpolate(time: number): void {
    for (const [playerId, rendered] of this.rendered) {
      const player = this.latestPlayers?.get(playerId);
      const position = interpolatePosition(
        rendered.sprite.x,
        rendered.sprite.y,
        rendered.targetX,
        rendered.targetY,
        rendered.isLocal ? 0.08 : 0.24,
        120
      );
      rendered.sprite.setPosition(position.x, position.y);
      if (!rendered.isLocal) {
        rendered.sprite.rotation = rotateTowards(
          rendered.sprite.rotation,
          rendered.targetAngle - Math.PI / 2,
          0.16
        );
        this.updateWalkAnimation(rendered, position.distance);
      }
      rendered.sprite.setDepth(Math.round(rendered.sprite.y) + 100);
      this.presentAction(rendered, player, time);
      this.presentWeaponAndPassenger(rendered, player, time);
      this.positionNameplate(rendered, player);
    }
    this.resolveNameplateOverlaps();
  }

  predictLocalMovement(x: number, y: number, deltaSeconds: number): void {
    const state = this.latestPlayers?.get(this.options.localPlayerId);
    const local = this.rendered.get(this.options.localPlayerId);
    if (!local || !state?.alive || state.vehicleId || state.action) return;
    const distance = PLAYER_SPEED * Math.min(deltaSeconds, 0.05);
    if (x !== 0 || y !== 0) local.sprite.play(local.animationKey, true);
    else if (local.sprite.anims.isPlaying) local.sprite.stop().setFrame(0);
    const nextX = local.sprite.x + x * distance;
    if (this.options.canOccupy(nextX, local.sprite.y)) local.sprite.x = nextX;
    const nextY = local.sprite.y + y * distance;
    if (this.options.canOccupy(local.sprite.x, nextY)) local.sprite.y = nextY;
  }

  aimOrigin(playerId: string): {x: number; y: number} | undefined {
    const rendered = this.rendered.get(playerId);
    const player = this.latestPlayers?.get(playerId);
    if (!rendered) return undefined;
    if (player?.vehicleId && player.vehicleSeat > 0) {
      const vehicle = this.options.vehiclePose(player.vehicleId);
      if (vehicle) {
        const passenger = passengerPresentation(
          vehicle,
          player.vehicleSeat,
          rendered.targetAngle,
          0,
          false
        );
        return {x: passenger.baseX, y: passenger.baseY};
      }
    }
    return {x: rendered.sprite.x, y: rendered.sprite.y};
  }

  setAim(playerId: string, angle: number): void {
    const rendered = this.rendered.get(playerId);
    if (!rendered) return;
    rendered.sprite.rotation = angle - Math.PI / 2;
    rendered.targetAngle = angle;
  }

  projectileCreated(ownerId: string, now: number): void {
    const rendered = this.rendered.get(ownerId);
    const player = this.latestPlayers?.get(ownerId);
    if (rendered && player?.vehicleId && player.vehicleSeat > 0) {
      rendered.peekRecoilUntil = now + 140;
    }
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) destroyPlayer(rendered);
    this.rendered.clear();
    this.latestPlayers = undefined;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private synchronizeOne(playerId: string, player: NetworkPlayer): void {
    let rendered = this.rendered.get(playerId);
    const isLocal = playerId === this.options.localPlayerId;
    if (!rendered) {
      rendered = this.create(player, isLocal);
      this.rendered.set(playerId, rendered);
    }
    const appearance = this.appearances.ensure(player.appearance);
    if (rendered.appearanceTextureKey !== appearance.textureKey) {
      rendered.sprite.stop().setTexture(appearance.textureKey, 0);
      rendered.passengerSprite.setTexture(appearance.textureKey, 0);
      rendered.appearanceTextureKey = appearance.textureKey;
      rendered.animationKey = appearance.animationKey;
      rendered.bodyScaleX = appearance.bodyScaleX;
    }
    rendered.targetX = player.x;
    rendered.targetY = player.y;
    rendered.targetAngle = player.angle;
    const visibleOnFoot = player.alive && !player.vehicleId;
    const visiblePassenger = player.alive && Boolean(player.vehicleId) && player.vehicleSeat > 0;
    rendered.sprite.setVisible(visibleOnFoot);
    rendered.passengerSprite.setVisible(visiblePassenger && !player.action);
    rendered.label.setVisible(player.alive).setText(player.name);
    rendered.weaponSprite.setVisible((visibleOnFoot || visiblePassenger) && !player.action);
    if (rendered.weapon !== player.weapon) {
      rendered.weapon = player.weapon;
      applyWeaponPresentation(rendered.weaponSprite, player.weapon);
    }
    if (isLocal) {
      const damaged = player.health < this.lastLocalHealth;
      this.options.onLocalState(playerId, player, rendered.sprite, damaged);
      this.lastLocalHealth = player.health;
    }
  }

  private create(player: NetworkPlayer, isLocal: boolean): RenderPlayer {
    const appearance = this.appearances.ensure(player.appearance);
    const sprite = this.scene.add.sprite(player.x, player.y, appearance.textureKey, 0)
      .setOrigin(0.5)
      .setScale(appearance.bodyScaleX, 1)
      .setDepth(Math.round(player.y) + 100);
    const label = this.scene.add.text(player.x, player.y - 31, player.name, {
      color: '#ffffff',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(950_000);
    const weaponSprite = this.scene.add.image(player.x, player.y, 'weapon-pistol')
      .setOrigin(0.16, 0.5)
      .setDepth(Math.round(player.y) + 101);
    applyWeaponPresentation(weaponSprite, player.weapon);
    const passengerSprite = this.scene.add.sprite(player.x, player.y, appearance.textureKey, 0)
      .setOrigin(0.5)
      .setScale(0.58 * appearance.bodyScaleX, 0.58)
      .setVisible(false)
      .setDepth(Math.round(player.y) + 101);
    return {
      sprite,
      passengerSprite,
      label,
      weaponSprite,
      weapon: player.weapon,
      appearanceTextureKey: appearance.textureKey,
      animationKey: appearance.animationKey,
      bodyScaleX: appearance.bodyScaleX,
      targetX: player.x,
      targetY: player.y,
      targetAngle: player.angle,
      isLocal,
      peekRecoilUntil: 0
    };
  }

  private presentAction(rendered: RenderPlayer, player: NetworkPlayer | undefined, time: number): void {
    if (player?.action) {
      const pulse = 1 + Math.sin(time / 58) * 0.08;
      rendered.sprite.setScale(rendered.bodyScaleX * pulse, pulse);
      rendered.sprite.rotation = rendered.targetAngle - Math.PI / 2 + Math.sin(time / 42) * 0.16;
    } else {
      rendered.sprite.setScale(rendered.bodyScaleX, 1);
    }
  }

  private presentWeaponAndPassenger(
    rendered: RenderPlayer,
    player: NetworkPlayer | undefined,
    time: number
  ): void {
    const aimAngle = rendered.isLocal
      ? rendered.targetAngle
      : rendered.sprite.rotation + Math.PI / 2;
    let weaponBaseX = rendered.sprite.x;
    let weaponBaseY = rendered.sprite.y;
    if (player?.vehicleId && player.vehicleSeat > 0) {
      const vehicle = this.options.vehiclePose(player.vehicleId);
      if (vehicle) {
        const passenger = passengerPresentation(
          vehicle,
          player.vehicleSeat,
          aimAngle,
          time,
          time < rendered.peekRecoilUntil
        );
        weaponBaseX = passenger.baseX;
        weaponBaseY = passenger.baseY;
        rendered.passengerSprite
          .setPosition(passenger.spriteX, passenger.spriteY)
          .setRotation(aimAngle - Math.PI / 2)
          .setScale(passenger.scale * rendered.bodyScaleX, passenger.scale)
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
  }

  private positionNameplate(rendered: RenderPlayer, player: NetworkPlayer | undefined): void {
    const vehicle = player?.vehicleId ? this.options.vehiclePose(player.vehicleId) : undefined;
    if (vehicle && player) {
      rendered.label.setPosition(vehicle.x, vehicle.y - 34 - Math.max(0, player.vehicleSeat) * 12);
    } else {
      rendered.label.setPosition(rendered.sprite.x, rendered.sprite.y - 31);
    }
  }

  private updateWalkAnimation(rendered: RenderPlayer, distance: number): void {
    if (!rendered.sprite.visible) return;
    if (distance > 0.75) rendered.sprite.play(rendered.animationKey, true);
    else if (rendered.sprite.anims.isPlaying) rendered.sprite.stop().setFrame(0);
  }

  private resolveNameplateOverlaps(): void {
    const placed: Array<{x: number; y: number}> = [];
    const labels = [...this.rendered.values()]
      .map((rendered) => rendered.label)
      .filter((label) => label.visible)
      .sort((left, right) => left.y - right.y || left.x - right.x);
    for (const label of labels) {
      let y = label.y;
      while (placed.some((position) => (
        Math.abs(position.x - label.x) < 54 && Math.abs(position.y - y) < 11
      ))) {
        y -= 12;
      }
      label.y = y;
      placed.push({x: label.x, y});
    }
  }
}

function applyWeaponPresentation(
  sprite: Phaser.GameObjects.Image,
  weapon: NetworkPlayer['weapon']
): void {
  const presentation = weaponPresentation(weapon);
  sprite.setTexture(presentation.texture).setDisplaySize(presentation.width, presentation.height);
}

function destroyPlayer(rendered: RenderPlayer): void {
  rendered.sprite.destroy();
  rendered.passengerSprite.destroy();
  rendered.label.destroy();
  rendered.weaponSprite.destroy();
}

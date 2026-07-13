import Phaser from 'phaser';
import type {NetworkPlayer} from '../types.ts';
import {interpolatePosition, rotateTowards} from './interpolation-policy.ts';
import {
  meleeAttackPresentationAtProgress,
  passengerPresentation,
  weaponPresentation,
  type MeleeAttackPresentation
} from './player-render-policy.ts';
import type {VehicleRenderPose} from './render-types.ts';
import {PlayerAppearanceTextureFactory} from '../appearance/player-appearance-texture-factory.ts';
import {combatReactionPresentation} from './combat-reaction-render-policy.ts';
import {actorBurnPresentation} from './actor-burn-render-policy.ts';
import {MotionSnapshotBuffer} from '../network/motion-snapshot-buffer.ts';
import {
  SavedOnFootPrediction,
  type OnFootPredictionCorrection
} from '../prediction/saved-on-foot-prediction.ts';
import type {OnFootInputMoveMessage} from '../../../shared/protocol/on-foot-input.ts';
import {onFootMovementScale} from '../../../shared/simulation/on-foot-step.ts';

interface RenderPlayer {
  sprite: Phaser.GameObjects.Sprite;
  passengerSprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  weaponSprite: Phaser.GameObjects.Image;
  protectionRing: Phaser.GameObjects.Arc;
  burnEffect: Phaser.GameObjects.Ellipse;
  weapon: NetworkPlayer['weapon'];
  appearanceTextureKey: string;
  animationKey: string;
  bodyScaleX: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
  isLocal: boolean;
  peekRecoilUntil: number;
  spawnProtected: boolean;
  burning: boolean;
  burnExpiresAt: number;
  attackSequence: number;
  attackWeapon: NetworkPlayer['weapon'];
  attackCombo: number;
  meleeActive: boolean;
  reactionActive: boolean;
  motion: MotionSnapshotBuffer;
  onFootPrediction: SavedOnFootPrediction;
  onFootCorrection?: OnFootPredictionCorrection;
  visualOffsetX: number;
  visualOffsetY: number;
  acknowledgedInputSequence: number;
  predictedSpaceId: string;
  localOnFoot: boolean;
}

interface PlayerRendererOptions {
  localPlayerId: string;
  vehiclePose: (vehicleId: string) => VehicleRenderPose | undefined;
  canOccupy: (spaceId: string, x: number, y: number, radius: number) => boolean;
  onPrediction?: (
    error: number,
    snapped: boolean,
    pendingMoves: number,
    acknowledgedMove: number,
    resimulated: boolean
  ) => void;
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

  synchronize(players?: Map<string, NetworkPlayer>, serverTimeMs = 0): void {
    this.latestPlayers = players;
    const present = new Set<string>();
    players?.forEach((player, playerId) => {
      present.add(playerId);
      this.synchronizeOne(playerId, player, serverTimeMs);
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

  interpolate(
    time: number,
    renderServerTimeMs = 0
  ): void {
    for (const [playerId, rendered] of this.rendered) {
      const player = this.latestPlayers?.get(playerId);
      const previousX = rendered.sprite.x;
      const previousY = rendered.sprite.y;
      const buffered = !rendered.isLocal && renderServerTimeMs > 0
        ? rendered.motion.sample(renderServerTimeMs)
        : undefined;
      const position = buffered
        ? {
          x: buffered.x,
          y: buffered.y,
          distance: Math.hypot(buffered.x - previousX, buffered.y - previousY),
          snapped: false
        }
        : rendered.isLocal
        ? {x: rendered.sprite.x, y: rendered.sprite.y, distance: 0, snapped: false}
        : interpolatePosition(
          rendered.sprite.x,
          rendered.sprite.y,
          rendered.targetX,
          rendered.targetY,
          0.24,
          120
        );
      rendered.sprite.setPosition(position.x, position.y);
      if (!rendered.isLocal) {
        rendered.sprite.rotation = buffered
          ? buffered.angle - Math.PI / 2
          : rotateTowards(rendered.sprite.rotation, rendered.targetAngle - Math.PI / 2, 0.16);
        this.updateWalkAnimation(rendered, position.distance);
      }
      rendered.sprite.setDepth(Math.round(rendered.sprite.y) + 100);
      this.presentAction(rendered, player, time);
      this.presentWeaponAndPassenger(rendered, player, time);
      this.positionNameplate(rendered, player);
      this.presentSpawnProtection(rendered, time);
      this.presentBurn(rendered, time);
    }
    this.resolveNameplateOverlaps();
  }

  predictLocalMovement(
    x: number,
    y: number,
    deltaSeconds: number
  ): OnFootInputMoveMessage[] {
    const state = this.latestPlayers?.get(this.options.localPlayerId);
    const local = this.rendered.get(this.options.localPlayerId);
    if (!local || !state?.alive || state.vehicleId) return [];
    const movementScale = combatReactionPresentation(state).stopMovement
      ? 0
      : onFootMovementScale(state.action, state.weapon, state.attackCombo ?? 0);
    const advanced = local.onFootPrediction.advance(
      {x, y},
      deltaSeconds,
      this.options.canOccupy,
      movementScale
    );
    const decay = Math.exp(-14 * Math.min(Math.max(deltaSeconds, 0), 0.05));
    local.visualOffsetX *= decay;
    local.visualOffsetY *= decay;
    local.sprite.setPosition(
      advanced.pose.x + local.visualOffsetX,
      advanced.pose.y + local.visualOffsetY
    );
    local.predictedSpaceId = advanced.pose.spaceId;
    if (movementScale > 0 && (x !== 0 || y !== 0)) local.sprite.play(local.animationKey, true);
    else if (local.sprite.anims.isPlaying) local.sprite.stop().setFrame(0);
    return advanced.outboundMoves;
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

  private synchronizeOne(playerId: string, player: NetworkPlayer, serverTimeMs: number): void {
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
    const previousSpaceId = rendered.predictedSpaceId;
    const authorityChanged = rendered.targetX !== player.x || rendered.targetY !== player.y ||
      previousSpaceId !== (player.spaceId || 'street');
    const acknowledgedSequence = player.lastInputSequence ?? 0;
    const acknowledgementChanged = rendered.acknowledgedInputSequence !== acknowledgedSequence;
    rendered.targetX = player.x;
    rendered.targetY = player.y;
    const localOnFoot = isLocal && player.alive && !player.vehicleId;
    if (localOnFoot && !rendered.localOnFoot) {
      rendered.onFootPrediction.initialize(
        {x: player.x, y: player.y, spaceId: player.spaceId || 'street'},
        acknowledgedSequence
      );
      rendered.sprite.setPosition(player.x, player.y);
      rendered.visualOffsetX = 0;
      rendered.visualOffsetY = 0;
      rendered.predictedSpaceId = player.spaceId || 'street';
      rendered.acknowledgedInputSequence = acknowledgedSequence;
    } else if (localOnFoot && (authorityChanged || acknowledgementChanged)) {
      const beforeX = rendered.sprite.x;
      const beforeY = rendered.sprite.y;
      const correction = rendered.onFootPrediction.reconcile(
        {x: player.x, y: player.y, spaceId: player.spaceId || 'street'},
        acknowledgedSequence,
        this.options.canOccupy
      );
      rendered.visualOffsetX = correction.hardCorrection ? 0 : beforeX - correction.pose.x;
      rendered.visualOffsetY = correction.hardCorrection ? 0 : beforeY - correction.pose.y;
      rendered.onFootCorrection = correction;
      rendered.predictedSpaceId = correction.pose.spaceId;
      rendered.acknowledgedInputSequence = acknowledgedSequence;
      this.options.onPrediction?.(
        correction.positionError,
        correction.hardCorrection,
        correction.pendingMoveCount,
        acknowledgedSequence,
        correction.resimulated
      );
    }
    rendered.localOnFoot = localOnFoot;
    rendered.targetAngle = player.angle;
    if (!isLocal && serverTimeMs > 0) {
      rendered.motion.push({timeMs: serverTimeMs, x: player.x, y: player.y, angle: player.angle});
    }
    const attackSequence = player.attackSequence ?? 0;
    if (rendered.attackSequence !== attackSequence) {
      rendered.attackSequence = attackSequence;
      if (player.action === 'melee') {
        rendered.attackWeapon = player.weapon;
        rendered.attackCombo = player.attackCombo ?? 0;
      }
    }
    const visibleOnFoot = player.alive && !player.vehicleId;
    const visiblePassenger = player.alive && Boolean(player.vehicleId) && player.vehicleSeat > 0;
    const heldWeapon = weaponPresentation(player.weapon);
    const reaction = combatReactionPresentation(player);
    rendered.sprite.setVisible(visibleOnFoot);
    rendered.passengerSprite.setVisible(visiblePassenger && (!player.action || reaction.active));
    rendered.label.setVisible(player.alive).setText(player.name);
    rendered.weaponSprite.setVisible(
      (visibleOnFoot || visiblePassenger) &&
      heldWeapon.visible &&
      !reaction.active &&
      (!player.action || player.action === 'melee')
    );
    rendered.spawnProtected = Boolean(player.spawnProtected) && visibleOnFoot;
    rendered.burning = Boolean(player.onFire) && visibleOnFoot;
    rendered.burnExpiresAt = player.fireExpiresAt ?? 0;
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
    const initialWeapon = weaponPresentation(player.weapon);
    const weaponSprite = this.scene.add.image(player.x, player.y, initialWeapon.texture)
      .setOrigin(initialWeapon.originX, 0.5)
      .setDepth(Math.round(player.y) + 101);
    applyWeaponPresentation(weaponSprite, player.weapon);
    const passengerSprite = this.scene.add.sprite(player.x, player.y, appearance.textureKey, 0)
      .setOrigin(0.5)
      .setScale(0.58 * appearance.bodyScaleX, 0.58)
      .setVisible(false)
      .setDepth(Math.round(player.y) + 101);
    const protectionRing = this.scene.add.circle(player.x, player.y, 20, 0x63dfff, 0.05)
      .setStrokeStyle(2, 0x63dfff, 0.9)
      .setVisible(false)
      .setDepth(Math.round(player.y) + 99);
    const burnEffect = this.scene.add.ellipse(player.x, player.y - 4, 22, 34, 0xff762e, 0.72)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(Math.round(player.y) + 103);
    return {
      sprite,
      passengerSprite,
      label,
      weaponSprite,
      protectionRing,
      burnEffect,
      weapon: player.weapon,
      appearanceTextureKey: appearance.textureKey,
      animationKey: appearance.animationKey,
      bodyScaleX: appearance.bodyScaleX,
      targetX: player.x,
      targetY: player.y,
      targetAngle: player.angle,
      isLocal,
      peekRecoilUntil: 0,
      spawnProtected: false,
      burning: false,
      burnExpiresAt: 0,
      attackSequence: -1,
      attackWeapon: player.weapon,
      attackCombo: 0,
      meleeActive: false,
      reactionActive: false,
      motion: new MotionSnapshotBuffer(),
      onFootPrediction: initializedOnFootPrediction(player),
      visualOffsetX: 0,
      visualOffsetY: 0,
      acknowledgedInputSequence: player.lastInputSequence ?? 0,
      predictedSpaceId: player.spaceId || 'street',
      localOnFoot: false
    };
  }

  private presentAction(rendered: RenderPlayer, player: NetworkPlayer | undefined, time: number): void {
    const reaction = combatReactionPresentation(player ?? {});
    if (reaction.active) {
      rendered.reactionActive = true;
      rendered.meleeActive = false;
      rendered.sprite.stop().setFrame(0)
        .setScale(rendered.bodyScaleX * reaction.scaleX, reaction.scaleY)
        .setRotation(rendered.targetAngle - Math.PI / 2 + reaction.rotationOffset);
      if (reaction.tint === undefined) rendered.sprite.clearTint();
      else rendered.sprite.setTint(reaction.tint);
      return;
    }
    if (rendered.reactionActive) {
      rendered.reactionActive = false;
      rendered.sprite.rotation = rendered.targetAngle - Math.PI / 2;
    }
    rendered.sprite.clearTint();
    const melee = this.meleePresentation(rendered, player);
    if (melee.active) {
      rendered.meleeActive = true;
      rendered.sprite.stop().setFrame(0)
        .setScale(rendered.bodyScaleX * melee.bodyScaleX, melee.bodyScaleY)
        .setRotation(rendered.targetAngle - Math.PI / 2 + melee.bodyRotationOffset);
      return;
    }
    if (rendered.meleeActive) {
      rendered.meleeActive = false;
      rendered.sprite.rotation = rendered.targetAngle - Math.PI / 2;
    }
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
    const reaction = combatReactionPresentation(player ?? {});
    const melee = this.meleePresentation(rendered, player);
    const aimAngle = melee.active
      ? rendered.targetAngle
      : rendered.isLocal
      ? rendered.targetAngle
      : rendered.sprite.rotation + Math.PI / 2;
    const weaponAngle = aimAngle + melee.weaponRotationOffset;
    const weaponDistance = melee.active ? melee.weaponDistance : 7;
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
          .setRotation(aimAngle - Math.PI / 2 + reaction.rotationOffset)
          .setScale(
            passenger.scale * rendered.bodyScaleX * reaction.scaleX,
            passenger.scale * reaction.scaleY
          )
          .setDepth(Math.round(weaponBaseY) + 101);
        if (reaction.tint === undefined) rendered.passengerSprite.clearTint();
        else rendered.passengerSprite.setTint(reaction.tint);
      }
    }
    rendered.weaponSprite
      .setPosition(
        weaponBaseX + Math.cos(weaponAngle) * weaponDistance,
        weaponBaseY + Math.sin(weaponAngle) * weaponDistance
      )
      .setRotation(weaponAngle)
      .setDepth(Math.round(weaponBaseY) + 102);
  }

  private meleePresentation(
    rendered: RenderPlayer,
    player: NetworkPlayer | undefined
  ): MeleeAttackPresentation {
    const interrupted = !player?.alive || player.weapon !== rendered.attackWeapon ||
      Boolean(player.action && player.action !== 'melee') ||
      combatReactionPresentation(player ?? {}).stopMovement;
    return meleeAttackPresentationAtProgress(
      rendered.attackWeapon,
      rendered.attackCombo,
      interrupted ? 1 : (player?.attackProgress ?? 0)
    );
  }

  private positionNameplate(rendered: RenderPlayer, player: NetworkPlayer | undefined): void {
    const vehicle = player?.vehicleId ? this.options.vehiclePose(player.vehicleId) : undefined;
    if (vehicle && player) {
      rendered.label.setPosition(vehicle.x, vehicle.y - 34 - Math.max(0, player.vehicleSeat) * 12);
    } else {
      rendered.label.setPosition(rendered.sprite.x, rendered.sprite.y - 31);
    }
  }

  private presentSpawnProtection(rendered: RenderPlayer, time: number): void {
    const pulse = 0.85 + (Math.sin(time / 130) + 1) * 0.12;
    rendered.protectionRing
      .setPosition(rendered.sprite.x, rendered.sprite.y)
      .setScale(pulse)
      .setAlpha(0.55 + (Math.sin(time / 105) + 1) * 0.18)
      .setVisible(rendered.spawnProtected);
  }

  private presentBurn(rendered: RenderPlayer, time: number): void {
    const presentation = actorBurnPresentation({
      id: rendered.appearanceTextureKey,
      alive: rendered.sprite.visible,
      onFire: rendered.burning,
      fireExpiresAt: rendered.burnExpiresAt
    }, time);
    rendered.burnEffect
      .setPosition(rendered.sprite.x, rendered.sprite.y - 5)
      .setScale(presentation.scaleX, presentation.scaleY)
      .setAlpha(presentation.alpha)
      .setDepth(Math.round(rendered.sprite.y) + 103)
      .setVisible(presentation.visible);
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

function initializedOnFootPrediction(player: NetworkPlayer): SavedOnFootPrediction {
  const prediction = new SavedOnFootPrediction();
  prediction.initialize(
    {x: player.x, y: player.y, spaceId: player.spaceId || 'street'},
    player.lastInputSequence ?? 0
  );
  return prediction;
}

function applyWeaponPresentation(
  sprite: Phaser.GameObjects.Image,
  weapon: NetworkPlayer['weapon']
): void {
  const presentation = weaponPresentation(weapon);
  sprite
    .setTexture(presentation.texture)
    .setDisplaySize(presentation.width, presentation.height)
    .setOrigin(presentation.originX, 0.5);
}

function destroyPlayer(rendered: RenderPlayer): void {
  rendered.sprite.destroy();
  rendered.passengerSprite.destroy();
  rendered.label.destroy();
  rendered.weaponSprite.destroy();
  rendered.protectionRing.destroy();
  rendered.burnEffect.destroy();
}

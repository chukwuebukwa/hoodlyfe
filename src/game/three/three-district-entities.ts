import * as THREE from 'three';
import type {
  DistrictNetworkState,
  NetworkNpc,
  NetworkPlayer,
  NetworkStinger,
  NetworkVehicle
} from '../types.ts';
import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  appearanceSpritePresentation,
} from '../appearance/appearance-render-policy.ts';
import {compileCharacterSpriteSet} from '../appearance/character-sprite-compiler.ts';
import {
  compileLpcCharacterSpriteSet,
  loadLpcSpriteSources,
  type LpcSpriteSources
} from '../appearance/lpc-character-sprite-compiler.ts';
import {CHARACTER_ATLASES} from '../../../shared/content/character-animation-manifest.ts';
import {parseLpcRecipe} from '../../../shared/content/lpc-character-catalog.ts';
import {
  meleeAttackPresentationAtProgress,
  playerAttachmentPresentation,
  weaponPresentation
} from '../rendering/player-render-policy.ts';
import {pedestrianMotionPresentation} from '../rendering/pedestrian-render-policy.ts';
import {combatReactionPresentation} from '../rendering/combat-reaction-render-policy.ts';
import {npcMeleePresentation} from '../rendering/npc-melee-render-policy.ts';
import {rotateTowards} from '../rendering/interpolation-policy.ts';
import {vehicleVisualState} from '../rendering/vehicle-render-policy.ts';
import {actorBurnPresentation} from '../rendering/actor-burn-render-policy.ts';
import {
  emergencyLightPresentation,
  vehicleLightPresentation
} from '../rendering/vehicle-light-render-policy.ts';
import {
  ACTION_SPRITE_COLUMNS,
  ACTION_SPRITE_ROWS,
  ejectedDriverActionSprite,
  npcActionSprite,
  playerActionSprite,
  VEHICLE_DOOR_COLUMNS,
  VEHICLE_DOOR_ROWS,
  vehicleDoorAtlasFrame,
  vehicleDoorPresentation
} from '../rendering/action-sprite-policy.ts';
import {
  serverAngleToThree,
  serverPedestrianAngleToThree,
  serverVehicleAngleToThree,
  serverYToThree,
  renderedVehicleLampAnchor
} from './three-prototype-policy.ts';
import {radialGlow, updateRadialGlow, type RadialGlow} from './three-glow.ts';
import type {MovementVector} from '../input/client-input-policy.ts';
import {
  SavedVehiclePrediction,
  type VehicleInputMove,
  type VehiclePredictionCorrection
} from '../prediction/saved-vehicle-prediction.ts';
import {
  createHumanoidPhysicsPoseStepper,
  createVehiclePhysicsPoseStepper
} from '../prediction/vehicle-physics-replay.ts';
import type {PhysicsWorld} from '../../../shared/physics/physics-world.ts';
import {vehicleMechanicalStepModifiers} from '../../../shared/simulation/vehicle-step.ts';
import type {VehicleRenderPose} from '../rendering/render-types.ts';
import {type RemoteMotionSample, type RemoteMotionTimeline} from '../network/remote-motion-timeline.ts';
import {createRemoteMotionTimeline} from '../network/remote-timeline-config.ts';
import {
  SavedOnFootPrediction,
  type OnFootPredictionCorrection
} from '../prediction/saved-on-foot-prediction.ts';
import type {OnFootInputMoveMessage} from '../../../shared/protocol/on-foot-input.ts';
import {onFootMovementScale} from '../../../shared/simulation/on-foot-step.ts';
import {
  angleCorrectionOffset,
  decayCorrectionOffset,
  ON_FOOT_CORRECTION_DECAY_RATE,
  positionCorrectionOffset,
  VEHICLE_CORRECTION_DECAY_RATE
} from '../rendering/correction-smoothing.ts';
import type {InteractionIslandReplayResult} from '../prediction/interaction-island-replay.ts';
import type {InteractionIslandBaseline} from '../prediction/island-state-history.ts';
import {
  applyVehicleInteractionReplay,
  prepareVehicleInteractionReplay,
  type VehicleInteractionReplayPreparation
} from '../prediction/vehicle-interaction-replay.ts';
import {
  applyOnFootInteractionReplay,
  prepareOnFootInteractionReplay,
  type OnFootInteractionReplayPreparation
} from '../prediction/on-foot-interaction-replay.ts';
import {InteractionReplayPresentation} from '../rendering/interaction-replay-presentation.ts';
import {createFireSmokeEffect, updateFireSmokeEffect} from './three-fire-smoke-effect.ts';
import {POLICE_STINGER_SEGMENT_COUNT} from '../../../shared/simulation/police-stinger-contact.ts';

interface RenderedEntity {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  label?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  weapon?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  smoke?: THREE.Object3D;
  fire?: THREE.Object3D;
  blood?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  headlight?: RadialGlow;
  taillight?: RadialGlow;
  emergencyRed?: RadialGlow;
  emergencyBlue?: RadialGlow;
  appearanceKey?: string;
  attackSequence?: number;
  attackWeapon?: NetworkPlayer['weapon'];
  attackCombo?: number;
  spriteKey?: string;
  vehicleActionKey?: string;
  vehicleActionStartedAt?: number;
  ejectionToken?: number;
  ejectionStartedAt?: number;
  localDriver?: boolean;
  predictedAngle?: number;
  predictedSpeed?: number;
  authoritativeX?: number;
  authoritativeY?: number;
  authoritativeAngle?: number;
  authoritativeSpeed?: number;
  authorityDirty?: boolean;
  localPlayer?: boolean;
  localOnFoot?: boolean;
  motion?: RemoteMotionTimeline;
  onFootPrediction?: SavedOnFootPrediction;
  onFootCorrection?: OnFootPredictionCorrection;
  predictedSpaceId?: string;
  acknowledgedInputSequence?: number;
  vehiclePrediction?: SavedVehiclePrediction;
  vehicleCorrection?: VehiclePredictionCorrection;
  visualOffsetX?: number;
  visualOffsetY?: number;
  visualOffsetAngle?: number;
  acknowledgedVehicleInputSequence?: number;
  interactionReplayAcknowledgedSequence?: number;
  presentationPose?: VehicleRenderPose;
  presentationAimOrigin?: {x: number; y: number};
}

interface EntityTextures {
  player: THREE.Texture;
  playerWalkColumns: number;
  playerWalkRows: number;
  playerDirectionalWalk: boolean;
  civilian: THREE.Texture;
  police: THREE.Texture;
  vehicles: THREE.Texture;
  playerActions: THREE.Texture;
  playerWalkMask: THREE.Texture;
  playerActionMask: THREE.Texture;
  civilianActions: THREE.Texture;
  policeActions: THREE.Texture;
  vehicleDoors: THREE.Texture;
  blood: THREE.Texture;
  weapons: Record<NetworkPlayer['weapon'], THREE.Texture>;
}

interface CompiledAppearanceTextures {
  walk: THREE.Texture;
  walkColumns: number;
  walkRows: number;
  directionalWalk: boolean;
  actions: THREE.Texture;
  actionsColumns: number;
  actionsRows: number;
}

interface PlayerCharacterSources {
  walk: string;
  walkColumns: number;
  walkRows: number;
  directionalWalk: boolean;
  actions: string;
  walkMask: string;
  actionMask: string;
}

const MAX_COMPILED_APPEARANCES = 96;
const LPC_SPIKE_STORAGE_KEY = 'nock0-use-lpc-spike';
const LPC_SPIKE_ATLASES: Readonly<PlayerCharacterSources> = Object.freeze({
  walk: '/assets/custom/lpc-spike/player-lpc-walk-4dir.png',
  walkColumns: 9,
  walkRows: 4,
  directionalWalk: true,
  actions: '/assets/custom/lpc-spike/player-lpc-actions.png',
  walkMask: '/assets/custom/lpc-spike/player-lpc-walk-4dir-mask.png',
  actionMask: '/assets/custom/lpc-spike/player-lpc-actions-mask.png'
});

export class ThreeDistrictEntities {
  private readonly rendered = new Map<string, RenderedEntity>();
  private readonly appearances = new Map<string, CompiledAppearanceTextures>();
  private readonly replayPresentation = new InteractionReplayPresentation();

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly textures: EntityTextures,
    private readonly lpcSources: LpcSpriteSources,
    private readonly surfaceHeightAt: (x: number, y: number) => number,
    private readonly canOccupy: (spaceId: string, x: number, y: number, radius: number) => boolean,
    private readonly onRemoteTimeline?: (
      sample: Pick<RemoteMotionSample, 'snapshotAgeMs' | 'bufferUnderrun' | 'mode'>
    ) => void,
    private readonly remoteTimelinesEnabled: () => boolean = () => true,
    private readonly vehiclePhysicsWorld: () => PhysicsWorld | undefined = () => undefined
  ) {}

  static async create(
    scene: THREE.Scene,
    surfaceHeightAt: (x: number, y: number) => number,
    canOccupy: (spaceId: string, x: number, y: number, radius: number) => boolean = () => true,
    onRemoteTimeline?: (
      sample: Pick<RemoteMotionSample, 'snapshotAgeMs' | 'bufferUnderrun' | 'mode'>
    ) => void,
    remoteTimelinesEnabled: () => boolean = () => true,
    vehiclePhysicsWorld: () => PhysicsWorld | undefined = () => undefined
  ): Promise<ThreeDistrictEntities> {
    const loader = new THREE.TextureLoader();
    const characterSources = playerCharacterSources();
    const lpcSources = await loadLpcSpriteSources();
    const [
      player, civilian, police, vehicles, playerActions, playerWalkMask, playerActionMask,
      civilianActions, policeActions,
      vehicleDoors, blood, fists, bat, pistol, smg, shotgun, rocket, grenade, molotov
    ] = await Promise.all([
      loader.loadAsync(characterSources.walk),
      loader.loadAsync('/assets/original/sprites/civilian.png'),
      loader.loadAsync('/assets/original/sprites/police.png'),
      loader.loadAsync('/assets/original/sprites/vehicles.png'),
      loader.loadAsync(characterSources.actions),
      loader.loadAsync(characterSources.walkMask),
      loader.loadAsync(characterSources.actionMask),
      loader.loadAsync('/assets/custom/actions/civilian-actions.png'),
      loader.loadAsync('/assets/custom/actions/police-actions.png'),
      loader.loadAsync('/assets/custom/actions/vehicle-doors.png'),
      loader.loadAsync('/assets/custom/actions/bloodstain.png'),
      loader.loadAsync('/assets/original/weapons/fists.svg'),
      loader.loadAsync('/assets/original/weapons/bat.svg'),
      loader.loadAsync('/assets/original/weapons/pistol.svg'),
      loader.loadAsync('/assets/original/weapons/smg.svg'),
      loader.loadAsync('/assets/original/weapons/shotgun.svg'),
      loader.loadAsync('/assets/original/weapons/rocket.svg'),
      loader.loadAsync('/assets/original/weapons/grenade.svg'),
      loader.loadAsync('/assets/original/weapons/molotov.svg')
    ]);
    for (const texture of [
      player, civilian, police, vehicles, playerActions, playerWalkMask, playerActionMask,
      civilianActions, policeActions,
      vehicleDoors, blood, fists, bat, pistol, smg, shotgun, rocket, grenade, molotov
    ]) {
      configureTexture(texture);
    }
    return new ThreeDistrictEntities(
      scene,
      {
        player,
        playerWalkColumns: characterSources.walkColumns,
        playerWalkRows: characterSources.walkRows,
        playerDirectionalWalk: characterSources.directionalWalk,
        civilian, police, vehicles, playerActions, playerWalkMask, playerActionMask,
        civilianActions, policeActions,
        vehicleDoors, blood, weapons: {fists, bat, pistol, smg, shotgun, rocket, grenade, molotov}
      },
      lpcSources,
      surfaceHeightAt,
      canOccupy,
      onRemoteTimeline,
      remoteTimelinesEnabled,
      vehiclePhysicsWorld
    );
  }

  synchronize(
    state: DistrictNetworkState,
    localSpaceId = 'street',
    localPlayerId = '',
    renderServerTimeMs = state.serverTimeMs ?? 0,
    estimatedServerTimeMs = state.serverTimeMs ?? renderServerTimeMs
  ): void {
    const present = new Set<string>();
    const localPlayer = localPlayerId ? state.players.get(localPlayerId) : undefined;
    state.players.forEach((player, id) => {
      if ((player.spaceId || 'street') !== localSpaceId) return;
      present.add(`player:${id}`);
      this.synchronizePlayer(
        `player:${id}`,
        player,
        state,
        id === localPlayerId,
        renderServerTimeMs,
        estimatedServerTimeMs
      );
    });
    state.npcs.forEach((npc, id) => {
      if (localSpaceId !== 'street') return;
      present.add(`npc:${id}`);
      this.synchronizeNpc(
        `npc:${id}`,
        npc,
        state.serverTimeMs ?? 0,
        renderServerTimeMs,
        estimatedServerTimeMs
      );
    });
    state.vehicles.forEach((vehicle, id) => {
      if (localSpaceId !== 'street') return;
      present.add(`vehicle:${id}`);
      this.synchronizeVehicle(
        `vehicle:${id}`,
        vehicle,
        state.players.values(),
        localPlayer?.vehicleId === id,
        localPlayer?.vehicleId === id && localPlayer.vehicleSeat === 0,
        state.serverTimeMs ?? 0,
        renderServerTimeMs,
        estimatedServerTimeMs
      );
    });
    state.stingers?.forEach((stinger, id) => {
      if (localSpaceId !== 'street') return;
      present.add(`stinger:${id}`);
      this.synchronizeStinger(`stinger:${id}`, stinger);
    });
    for (const [id, rendered] of this.rendered) {
      if (present.has(id)) continue;
      this.remove(id, rendered);
    }
  }

  private synchronizeStinger(id: string, stinger: NetworkStinger): void {
    const rendered = this.obtain(id, () => ({mesh: policeStingerMesh()}));
    const segmentCount = Math.max(
      0,
      Math.min(POLICE_STINGER_SEGMENT_COUNT, Math.floor(stinger.activeSegmentCount))
    );
    if (
      rendered.mesh.userData.activeSegmentCount !== segmentCount ||
      rendered.mesh.userData.stingerPhase !== stinger.phase
    ) {
      paintPoliceStinger(rendered.mesh, segmentCount, stinger.phase);
    }
    rendered.mesh.position.set(
      stinger.x,
      serverYToThree(stinger.y),
      this.surfaceHeightAt(stinger.x, stinger.y) + 7
    );
    rendered.mesh.rotation.z = serverAngleToThree(stinger.angle);
    rendered.mesh.visible = segmentCount > 0;
    rendered.mesh.userData.stinger = stinger;
  }

  vehiclePose(vehicleId: string): VehicleRenderPose | undefined {
    const rendered = this.rendered.get(`vehicle:${vehicleId}`);
    if (!rendered) return undefined;
    return {
      x: rendered.mesh.position.x,
      y: serverYToThree(rendered.mesh.position.y),
      angle: rendered.predictedAngle ?? 0
    };
  }

  playerPose(playerId: string): VehicleRenderPose | undefined {
    const rendered = this.rendered.get(`player:${playerId}`);
    if (!rendered) return undefined;
    return rendered.presentationPose ?? {
      x: rendered.mesh.position.x,
      y: serverYToThree(rendered.mesh.position.y),
      angle: rendered.predictedAngle ?? 0
    };
  }

  playerAimOrigin(playerId: string): {x: number; y: number} | undefined {
    const rendered = this.rendered.get(`player:${playerId}`);
    return rendered?.presentationAimOrigin;
  }

  predictLocalPlayer(
    playerId: string,
    movement: MovementVector,
    deltaSeconds: number
  ): {correction?: OnFootPredictionCorrection; outboundMoves: OnFootInputMoveMessage[]} | undefined {
    const rendered = this.rendered.get(`player:${playerId}`);
    const player = rendered?.mesh.userData.player as NetworkPlayer | undefined;
    if (!rendered?.localPlayer || !player?.alive || player.vehicleId || !rendered.onFootPrediction) {
      return undefined;
    }
    const movementScale = combatReactionPresentation(player).stopMovement
      ? 0
      : onFootMovementScale(player.action, player.weapon, player.attackCombo ?? 0);
    const advanced = rendered.onFootPrediction.advance(
      movement,
      deltaSeconds,
      this.canOccupy,
      movementScale
    );
    rendered.visualOffsetX = decayCorrectionOffset(
      rendered.visualOffsetX ?? 0,
      deltaSeconds,
      ON_FOOT_CORRECTION_DECAY_RATE
    );
    rendered.visualOffsetY = decayCorrectionOffset(
      rendered.visualOffsetY ?? 0,
      deltaSeconds,
      ON_FOOT_CORRECTION_DECAY_RATE
    );
    const x = advanced.pose.x + rendered.visualOffsetX;
    const y = advanced.pose.y + rendered.visualOffsetY;
    rendered.predictedSpaceId = advanced.pose.spaceId;
    rendered.mesh.position.set(x, serverYToThree(y), this.surfaceHeightAt(x, y) + 4);
    rendered.mesh.userData.worldX = x;
    rendered.mesh.userData.worldY = y;
    const correction = rendered.onFootCorrection;
    rendered.onFootCorrection = undefined;
    return {correction, outboundMoves: advanced.outboundMoves};
  }

  predictLocalVehicle(
    vehicleId: string,
    movement: MovementVector,
    deltaSeconds: number
  ): {correction?: VehiclePredictionCorrection; outboundMoves: VehicleInputMove[]} | undefined {
    const rendered = this.rendered.get(`vehicle:${vehicleId}`);
    const vehicle = rendered?.mesh.userData.vehicle as NetworkVehicle | undefined;
    if (!rendered?.localDriver || !vehicle) return undefined;
    const advanced = rendered.vehiclePrediction?.advance(
      movement,
      vehicle.kind,
      deltaSeconds,
      (x, y, radius) => this.canOccupy('street', x, y, radius),
      vehicleMechanicalStepModifiers(
        vehicle.engineDamage,
        vehicle.onFire,
        vehicle.tyreDamageMask
      )
    );
    if (!advanced) return undefined;
    rendered.visualOffsetX = decayCorrectionOffset(
      rendered.visualOffsetX ?? 0,
      deltaSeconds,
      VEHICLE_CORRECTION_DECAY_RATE
    );
    rendered.visualOffsetY = decayCorrectionOffset(
      rendered.visualOffsetY ?? 0,
      deltaSeconds,
      VEHICLE_CORRECTION_DECAY_RATE
    );
    rendered.visualOffsetAngle = decayCorrectionOffset(
      rendered.visualOffsetAngle ?? 0,
      deltaSeconds,
      VEHICLE_CORRECTION_DECAY_RATE
    );
    const predicted = {
      ...advanced.pose,
      x: advanced.pose.x + rendered.visualOffsetX,
      y: advanced.pose.y + rendered.visualOffsetY,
      angle: advanced.pose.angle + rendered.visualOffsetAngle
    };
    rendered.predictedAngle = predicted.angle;
    rendered.predictedSpeed = predicted.speed;
    rendered.mesh.position.set(
      predicted.x,
      serverYToThree(predicted.y),
      this.surfaceHeightAt(predicted.x, predicted.y) + 3
    );
    rendered.mesh.rotation.z = serverVehicleAngleToThree(predicted.angle);
    rendered.mesh.userData.worldX = predicted.x;
    rendered.mesh.userData.worldY = predicted.y;
    this.positionVehicleEffects(rendered, vehicle);
    const correction = rendered.vehicleCorrection;
    rendered.vehicleCorrection = undefined;
    return {correction, outboundMoves: advanced.outboundMoves};
  }

  prepareInteractionReplay(
    baseline: InteractionIslandBaseline
  ): VehicleInteractionReplayPreparation | OnFootInteractionReplayPreparation | undefined {
    if (baseline.controlMode === 'driver') {
      const rendered = this.rendered.get(`vehicle:${baseline.rootId}`);
      if (!rendered?.localDriver || !rendered.vehiclePrediction) return undefined;
      return prepareVehicleInteractionReplay(rendered.vehiclePrediction, baseline);
    }
    if (baseline.controlMode === 'on-foot') {
      const rendered = this.rendered.get(`player:${baseline.rootId}`);
      if (!rendered?.localOnFoot || !rendered.onFootPrediction) return undefined;
      return prepareOnFootInteractionReplay(rendered.onFootPrediction, baseline);
    }
    return undefined;
  }

  applyInteractionReplay(
    baseline: InteractionIslandBaseline,
    result: InteractionIslandReplayResult
  ): boolean {
    if (baseline.controlMode === 'on-foot') {
      const rendered = this.rendered.get(`player:${baseline.rootId}`);
      if (!rendered?.localOnFoot || !rendered.onFootPrediction) return false;
      const beforeX = rendered.mesh.position.x;
      const beforeY = serverYToThree(rendered.mesh.position.y);
      const correction = applyOnFootInteractionReplay(
        rendered.onFootPrediction,
        baseline,
        result
      );
      if (!correction) return false;
      const offset = positionCorrectionOffset(
        beforeX,
        beforeY,
        correction.pose.x,
        correction.pose.y,
        correction.hardCorrection
      );
      rendered.visualOffsetX = offset.x;
      rendered.visualOffsetY = offset.y;
      rendered.onFootCorrection = correction;
      rendered.predictedSpaceId = correction.pose.spaceId;
      rendered.interactionReplayAcknowledgedSequence =
        baseline.acknowledgedLocalInputSequence;
      this.replayPresentation.promote(baseline, result);
      return true;
    }
    if (baseline.controlMode !== 'driver') return false;
    const rendered = this.rendered.get(`vehicle:${baseline.rootId}`);
    if (!rendered?.localDriver || !rendered.vehiclePrediction) return false;
    const beforeX = rendered.mesh.position.x;
    const beforeY = serverYToThree(rendered.mesh.position.y);
    const beforeAngle = rendered.predictedAngle ?? 0;
    const correction = applyVehicleInteractionReplay(
      rendered.vehiclePrediction,
      baseline,
      result
    );
    if (!correction) return false;
    const offset = positionCorrectionOffset(
      beforeX,
      beforeY,
      correction.pose.x,
      correction.pose.y,
      correction.hardCorrection
    );
    rendered.visualOffsetX = offset.x;
    rendered.visualOffsetY = offset.y;
    rendered.visualOffsetAngle = angleCorrectionOffset(
      beforeAngle,
      correction.pose.angle,
      correction.hardCorrection
    );
    rendered.predictedSpeed = correction.pose.speed;
    rendered.vehicleCorrection = correction;
    rendered.interactionReplayAcknowledgedSequence =
      baseline.acknowledgedLocalInputSequence;
    this.replayPresentation.promote(baseline, result);
    return true;
  }

  updateVehicleLights(nightIntensity: number, focusX: number, focusY: number): void {
    const nearby = new Set(
      [...this.rendered.entries()]
        .filter(([id]) => id.startsWith('vehicle:'))
        .map(([id, rendered]) => ({
          id,
          distance: Math.hypot(
            Number(rendered.mesh.userData.worldX ?? 0) - focusX,
            Number(rendered.mesh.userData.worldY ?? 0) - focusY
          )
        }))
        .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
        .slice(0, 10)
        .map(({id}) => id)
    );
    for (const [id, rendered] of this.rendered) {
      if (!id.startsWith('vehicle:') || !rendered.headlight || !rendered.taillight) continue;
      const vehicle = rendered.mesh.userData.vehicle as NetworkVehicle | undefined;
      if (!vehicle) continue;
      const presentation = vehicleLightPresentation(vehicle, nightIntensity, nearby.has(id));
      rendered.headlight.visible = presentation.active && presentation.frontOpacity > 0.01;
      updateRadialGlow(rendered.headlight, 0xfff2c7, presentation.frontOpacity);
      rendered.taillight.visible = presentation.active && presentation.rearOpacity > 0.01;
      updateRadialGlow(rendered.taillight, presentation.rearColor, presentation.rearOpacity);
    }
  }

  destroy(): void {
    for (const [id, rendered] of this.rendered) this.remove(id, rendered);
    this.replayPresentation.clear();
    for (const texture of [
      this.textures.player,
      this.textures.civilian,
      this.textures.police,
      this.textures.vehicles,
      this.textures.playerActions,
      this.textures.playerWalkMask,
      this.textures.playerActionMask,
      this.textures.civilianActions,
      this.textures.policeActions,
      this.textures.vehicleDoors,
      this.textures.blood,
      ...Object.values(this.textures.weapons)
    ]) texture.dispose();
    for (const textures of this.appearances.values()) {
      textures.walk.dispose();
      textures.actions.dispose();
    }
    this.appearances.clear();
  }

  private synchronizePlayer(
    id: string,
    player: NetworkPlayer,
    state: DistrictNetworkState,
    isLocal: boolean,
    renderServerTimeMs: number,
    estimatedServerTimeMs: number
  ): void {
    const appearance = appearanceSpritePresentation(player.appearance);
    const appearanceTextures = this.appearanceTextureSet(player);
    const rendered = this.obtain(id, () => {
      const held = weaponPresentation(player.weapon);
      const weapon = spriteMesh(
        this.textures.weapons[player.weapon],
        1,
        1,
        0,
        held.width,
        held.height
      );
      weapon.geometry.dispose();
      weapon.geometry = weaponPlaneGeometry(held);
      weapon.userData.weapon = player.weapon;
      return {
        mesh: spriteMesh(
          appearanceTextures.walk,
          appearanceTextures.walkColumns,
          appearanceTextures.walkRows,
          0,
          58,
          58
        ),
        label: nameLabel(player.name),
        weapon,
        blood: spriteMesh(this.textures.blood, 4, 1, 3, 64, 64),
        fire: createFireSmokeEffect({radius: 11, seed: id.length, smokeWeight: 0.36}),
        appearanceKey: appearance.textureKey,
        motion: createRemoteMotionTimeline('player'),
        onFootPrediction: initializedOnFootPrediction(
          player,
          createHumanoidPhysicsPoseStepper(this.vehiclePhysicsWorld, id)
        ),
        predictedSpaceId: player.spaceId || 'street',
        acknowledgedInputSequence: player.lastInputSequence ?? 0,
        visualOffsetX: 0,
        visualOffsetY: 0
      };
    });
    const playerSpaceId = player.spaceId || 'street';
    const localOnFoot = isLocal && player.alive && !player.vehicleId;
    const authorityChanged = rendered.authoritativeX !== player.x ||
      rendered.authoritativeY !== player.y || rendered.predictedSpaceId !== playerSpaceId;
    const acknowledgedSequence = player.lastInputSequence ?? 0;
    const acknowledgementChanged = rendered.acknowledgedInputSequence !== acknowledgedSequence;
    rendered.localPlayer = isLocal;
    rendered.authoritativeX = player.x;
    rendered.authoritativeY = player.y;
    rendered.authoritativeAngle = player.angle;
    this.replayPresentation.observeAuthority(
      'player',
      player.id,
      state.serverTimeMs ?? 0
    );
    if (localOnFoot && !rendered.localOnFoot) {
      rendered.onFootPrediction?.initialize(
        {x: player.x, y: player.y, spaceId: playerSpaceId},
        acknowledgedSequence
      );
      rendered.mesh.position.set(
        player.x,
        serverYToThree(player.y),
        this.surfaceHeightAt(player.x, player.y) + 4
      );
      rendered.visualOffsetX = 0;
      rendered.visualOffsetY = 0;
      rendered.predictedSpaceId = playerSpaceId;
      rendered.acknowledgedInputSequence = acknowledgedSequence;
    } else if (
      localOnFoot &&
      (authorityChanged || acknowledgementChanged) &&
      rendered.interactionReplayAcknowledgedSequence !== acknowledgedSequence
    ) {
      const beforeX = rendered.mesh.position.x;
      const beforeY = serverYToThree(rendered.mesh.position.y);
      const correction = rendered.onFootPrediction?.reconcile(
        {x: player.x, y: player.y, spaceId: playerSpaceId},
        acknowledgedSequence,
        this.canOccupy
      );
      if (correction) {
        const offset = positionCorrectionOffset(
          beforeX,
          beforeY,
          correction.pose.x,
          correction.pose.y,
          correction.hardCorrection
        );
        rendered.visualOffsetX = offset.x;
        rendered.visualOffsetY = offset.y;
        rendered.onFootCorrection = correction;
        rendered.predictedSpaceId = correction.pose.spaceId;
        rendered.acknowledgedInputSequence = acknowledgedSequence;
      }
    }
    if (rendered.interactionReplayAcknowledgedSequence === acknowledgedSequence) {
      rendered.interactionReplayAcknowledgedSequence = undefined;
      rendered.acknowledgedInputSequence = acknowledgedSequence;
    }
    rendered.localOnFoot = localOnFoot;
    if (!isLocal && (state.serverTimeMs ?? 0) > 0) {
      rendered.motion?.push({
        timeMs: state.serverTimeMs ?? 0,
        x: player.x,
        y: player.y,
        angle: player.angle
      });
    }
    rendered.mesh.userData.player = player;
    const attackSequence = player.attackSequence ?? 0;
    if (rendered.attackSequence !== attackSequence) {
      rendered.attackSequence = attackSequence;
      if (player.action === 'melee') {
        rendered.attackWeapon = player.weapon;
        rendered.attackCombo = player.attackCombo ?? 0;
      }
    }
    const reaction = combatReactionPresentation(player);
    const meleeInterrupted = !player.alive || rendered.attackWeapon !== player.weapon ||
      Boolean(player.action && player.action !== 'melee') || reaction.active;
    const melee = rendered.attackWeapon
      ? meleeAttackPresentationAtProgress(
        rendered.attackWeapon,
        rendered.attackCombo ?? 0,
        meleeInterrupted ? 1 : (player.attackProgress ?? 0)
      )
      : undefined;
    const localNow = performance.now();
    const vehicleActionKey = player.action === 'entering' || player.action === 'hijacking'
      ? `${player.action}:${player.actionVehicleId}`
      : '';
    if (vehicleActionKey && rendered.vehicleActionKey !== vehicleActionKey) {
      rendered.vehicleActionKey = vehicleActionKey;
      rendered.vehicleActionStartedAt = localNow;
    } else if (!vehicleActionKey) {
      rendered.vehicleActionKey = '';
      rendered.vehicleActionStartedAt = undefined;
    }
    const actionSprite = playerActionSprite(player, localNow, rendered.vehicleActionStartedAt);
    if (actionSprite.sprite === 'walk') {
      if (rendered.appearanceKey !== appearance.textureKey || rendered.spriteKey !== 'walk') {
        setSpriteSheet(
          rendered.mesh,
          appearanceTextures.walk,
          appearanceTextures.walkColumns,
          appearanceTextures.walkRows,
          0,
          appearance.textureKey
        );
        rendered.appearanceKey = appearance.textureKey;
        rendered.spriteKey = 'walk';
      }
    } else {
      setSpriteSheet(
        rendered.mesh,
        appearanceTextures.actions,
        appearanceTextures.actionsColumns,
        appearanceTextures.actionsRows,
        actionSprite.frame,
        `${appearance.textureKey}:action:${actionSprite.sprite}`
      );
      rendered.spriteKey = `action:${actionSprite.sprite}`;
    }
    const held = weaponPresentation(player.weapon);
    const weaponMesh = rendered.weapon;
    if (weaponMesh && weaponMesh.userData.weapon !== player.weapon) {
      replaceTexture(weaponMesh, this.textures.weapons[player.weapon]);
      weaponMesh.geometry.dispose();
      weaponMesh.geometry = weaponPlaneGeometry(held);
      weaponMesh.userData.weapon = player.weapon;
    }
    const vehicle = player.vehicleId ? state.vehicles.get(player.vehicleId) : undefined;
    const vehiclePose = vehicle
      ? this.vehiclePose(player.vehicleId) ?? vehicle
      : undefined;
    const interaction = !isLocal && !vehicle
      ? this.replayPresentation.pose('player', player.id)
      : undefined;
    const buffered = !interaction && !isLocal && !vehicle && this.remoteTimelinesEnabled()
      ? rendered.motion?.sample(renderServerTimeMs, estimatedServerTimeMs)
      : undefined;
    if (buffered) this.onRemoteTimeline?.(buffered);
    const actorX = interaction?.x ?? buffered?.x ?? (
      localOnFoot ? rendered.mesh.position.x : player.x
    );
    const actorY = interaction?.y ?? buffered?.y ?? (
      localOnFoot ? serverYToThree(rendered.mesh.position.y) : player.y
    );
    const renderAngle = interaction?.angle ?? buffered?.angle ?? player.angle;
    const attachments = playerAttachmentPresentation(
      {x: actorX, y: actorY, angle: renderAngle},
      vehiclePose,
      player.vehicleSeat,
      player.angle,
      localNow,
      false
    );
    rendered.presentationPose = attachments.root;
    rendered.presentationAimOrigin = attachments.weaponBase;
    const x = attachments.body.x;
    const y = attachments.body.y;
    const z = this.surfaceHeightAt(x, y) + (attachments.passenger ? 8 : 4);
    if (localOnFoot) rendered.mesh.position.z = z;
    else positionEntity(rendered.mesh, x, y, z, buffered ? 1 : interaction ? 0.38 : 0.34);
    const bodyRotation = appearanceTextures.directionalWalk
      ? 0
      : serverPedestrianAngleToThree(renderAngle) -
        (reaction.active ? reaction.rotationOffset : (melee?.bodyRotationOffset ?? 0));
    rendered.mesh.rotation.z = appearanceTextures.directionalWalk
      ? bodyRotation
      : reaction.active || melee?.active
        ? bodyRotation
        : rotateTowards(rendered.mesh.rotation.z, bodyRotation, 0.22);
    const bodyScale = attachments.passenger?.scale ?? 1;
    const bodyScaleX = reaction.active ? reaction.scaleX : (melee?.bodyScaleX ?? 1);
    const bodyScaleY = reaction.active ? reaction.scaleY : (melee?.bodyScaleY ?? 1);
    rendered.mesh.scale.set(
      bodyScale * appearance.bodyScaleX * bodyScaleX,
      bodyScale * bodyScaleY,
      bodyScale
    );
    rendered.mesh.material.color.setHex(reaction.tint ?? 0xffffff);
    rendered.mesh.visible = attachments.bodyVisible;
    if (actionSprite.sprite === 'walk') {
      const facingDirectionRow = appearanceTextures.directionalWalk && held.visible && player.alive && !vehicle
        ? lpcAimDirectionRow(renderAngle)
        : undefined;
      updateWalkingFrame(
        rendered.mesh,
        x,
        y,
        Boolean(!vehicle && player.alive && !player.action && !melee?.active && !reaction.stopMovement),
        appearanceTextures.walkColumns,
        appearanceTextures.walkRows,
        appearanceTextures.directionalWalk,
        facingDirectionRow
      );
    }
    if (rendered.blood) {
      rendered.blood.position.set(player.x, serverYToThree(player.y), this.surfaceHeightAt(player.x, player.y) + 2);
      rendered.blood.visible = !player.alive && !vehicle;
    }
    if (rendered.fire) {
      const burn = actorBurnPresentation(player, performance.now());
      rendered.fire.position.set(
        rendered.mesh.position.x,
        rendered.mesh.position.y,
        rendered.mesh.position.z + 4
      );
      rendered.fire.visible = burn.visible && !vehicle;
      rendered.fire.scale.set(burn.scaleX, burn.scaleY, 1);
      updateFireSmokeEffect(rendered.fire, performance.now(), burn.alpha, id.length);
    }
    if (rendered.weapon) {
      const baseX = attachments.weaponBase.x;
      const baseY = attachments.weaponBase.y;
      const weaponAngle = renderAngle + (melee?.weaponRotationOffset ?? 0);
      const weaponDistance = melee?.active ? melee.weaponDistance : 8;
      rendered.weapon.position.set(
        baseX + Math.cos(weaponAngle) * weaponDistance,
        serverYToThree(baseY + Math.sin(weaponAngle) * weaponDistance),
        z + 2
      );
      rendered.weapon.rotation.z = serverAngleToThree(weaponAngle);
      rendered.weapon.visible = rendered.mesh.visible && held.visible &&
        !reaction.active &&
        (!player.action || player.action === 'melee');
    }
    if (rendered.label) {
      const labelX = attachments.root.x;
      const labelY = attachments.root.y;
      const labelZ = this.surfaceHeightAt(labelX, labelY) + 12;
      rendered.label.position.set(
        labelX,
        serverYToThree(labelY) + 40 + Math.max(0, player.vehicleSeat) * 13,
        labelZ
      );
      rendered.label.visible = player.alive;
    }
  }

  private synchronizeNpc(
    id: string,
    npc: NetworkNpc,
    serverTimeMs: number,
    renderServerTimeMs: number,
    estimatedServerTimeMs: number
  ): void {
    const texture = npc.kind === 'police' ? this.textures.police : this.textures.civilian;
    const rendered = this.obtain(id, () => ({
      mesh: spriteMesh(texture, 3, 3, 0, 54, 54),
      blood: spriteMesh(this.textures.blood, 4, 1, 3, 60, 60),
      fire: createFireSmokeEffect({radius: 10, seed: id.length, smokeWeight: 0.36}),
      spriteKey: 'walk',
      motion: createRemoteMotionTimeline('npc')
    }));
    this.replayPresentation.observeAuthority('pedestrian', npc.id, serverTimeMs);
    if (serverTimeMs > 0) {
      rendered.motion?.push({
        timeMs: serverTimeMs,
        x: npc.x,
        y: npc.y,
        angle: npc.angle
      });
    }
    const interaction = this.replayPresentation.pose('pedestrian', npc.id);
    const buffered = !interaction && this.remoteTimelinesEnabled()
      ? rendered.motion?.sample(renderServerTimeMs, estimatedServerTimeMs)
      : undefined;
    if (buffered) this.onRemoteTimeline?.(buffered);
    const x = interaction?.x ?? buffered?.x ?? npc.x;
    const y = interaction?.y ?? buffered?.y ?? npc.y;
    const angle = interaction?.angle ?? buffered?.angle ?? npc.angle;
    positionEntity(
      rendered.mesh,
      x,
      y,
      this.surfaceHeightAt(x, y) + 3,
      buffered ? 1 : interaction ? 0.36 : 0.28
    );
    const reaction = combatReactionPresentation(npc);
    const melee = npcMeleePresentation(npc);
    if (npc.ejectedAt && rendered.ejectionToken !== npc.ejectedAt) {
      rendered.ejectionToken = npc.ejectedAt;
      rendered.ejectionStartedAt = performance.now();
    }
    const actionSprite = ejectedDriverActionSprite(
      rendered.ejectionStartedAt,
      performance.now()
    ) ??
      npcActionSprite(npc.alive, npc.action, npc.attackProgress);
    if (actionSprite.sprite === 'walk') {
      if (rendered.spriteKey !== 'walk') {
        setSpriteSheet(rendered.mesh, texture, 3, 3, 0);
        rendered.spriteKey = 'walk';
      }
    } else {
      const actionTexture = npc.kind === 'police'
        ? this.textures.policeActions
        : this.textures.civilianActions;
      setSpriteSheet(
        rendered.mesh,
        actionTexture,
        ACTION_SPRITE_COLUMNS,
        ACTION_SPRITE_ROWS,
        actionSprite.frame,
        `action:${npc.kind}:${actionSprite.sprite}`
      );
      rendered.spriteKey = `action:${npc.kind}:${actionSprite.sprite}`;
    }
    const rotationOffset = reaction.active ? reaction.rotationOffset : melee.rotationOffset;
    const scaleX = reaction.active ? reaction.scaleX : melee.scaleX;
    const scaleY = reaction.active ? reaction.scaleY : melee.scaleY;
    const bodyRotation = serverPedestrianAngleToThree(angle) - rotationOffset;
    rendered.mesh.rotation.z = reaction.active || melee.active
      ? bodyRotation
      : rotateTowards(rendered.mesh.rotation.z, bodyRotation, 0.18);
    rendered.mesh.scale.set(scaleX, scaleY, 1);
    rendered.mesh.visible = true;
    const moving = actionSprite.sprite === 'walk' && updateWalkingFrame(
      rendered.mesh,
      x,
      y,
      npc.alive && !reaction.stopMovement && !melee.stopMovement
    );
    const presentation = pedestrianMotionPresentation(
      npc.action,
      moving ? 1 : 0,
      reaction.stopMovement || melee.stopMovement
    );
    rendered.mesh.material.opacity = actionSprite.sprite === 'dead' ? 1 : presentation.alpha;
    rendered.mesh.material.color.setHex(
      reaction.tint ?? melee.tint ?? presentation.tint ?? 0xffffff
    );
    if (rendered.blood) {
      rendered.blood.position.set(x, serverYToThree(y), this.surfaceHeightAt(x, y) + 2);
      rendered.blood.visible = !npc.alive || npc.action === 'dead';
    }
    if (rendered.fire) {
      const burn = actorBurnPresentation(npc, performance.now());
      rendered.fire.position.set(
        rendered.mesh.position.x,
        rendered.mesh.position.y,
        rendered.mesh.position.z + 4
      );
      rendered.fire.visible = burn.visible;
      rendered.fire.scale.set(burn.scaleX, burn.scaleY, 1);
      updateFireSmokeEffect(rendered.fire, performance.now(), burn.alpha, id.length);
    }
  }

  private synchronizeVehicle(
    id: string,
    vehicle: NetworkVehicle,
    players: Iterable<NetworkPlayer>,
    localOccupant: boolean,
    localDriver: boolean,
    serverTimeMs: number,
    renderServerTimeMs: number,
    estimatedServerTimeMs: number
  ): void {
    const definition = vehicleDefinition(vehicle.kind);
    const playerList = [...players];
    const visual = vehicleVisualState(vehicle);
    const rendered = this.obtain(id, () => ({
      mesh: spriteMesh(
        this.textures.vehicleDoors,
        VEHICLE_DOOR_COLUMNS,
        VEHICLE_DOOR_ROWS,
        vehicleDoorAtlasFrame(vehicle, 0),
        definition.presentation.width,
        definition.presentation.height
      ),
      smoke: createFireSmokeEffect({
        radius: Math.max(16, definition.presentation.width * 0.22),
        seed: id.length * 2.13,
        fireWeight: 0,
        smokeWeight: 1.2
      }),
      fire: createFireSmokeEffect({
        radius: Math.max(14, definition.presentation.width * 0.18),
        seed: id.length * 3.17,
        smokeWeight: 0.74
      }),
      headlight: radialGlow(84, 0xfff2c7, 0, 12),
      taillight: radialGlow(34, 0xff1f2f, 0, 10),
      emergencyRed: definition.presentation.emergencyLights
        ? radialGlow(38, 0xff303f, 0, 9)
        : undefined,
      emergencyBlue: definition.presentation.emergencyLights
        ? radialGlow(38, 0x3c73ff, 0, 9)
        : undefined,
      vehiclePrediction: new SavedVehiclePrediction(
        createVehiclePhysicsPoseStepper(this.vehiclePhysicsWorld, id)
      ),
      motion: createRemoteMotionTimeline('vehicle'),
      visualOffsetX: 0,
      visualOffsetY: 0,
      visualOffsetAngle: 0,
      acknowledgedVehicleInputSequence: 0
    }));
    const authorityChanged = (
      rendered.authoritativeX !== vehicle.x || rendered.authoritativeY !== vehicle.y ||
      rendered.authoritativeAngle !== vehicle.angle || rendered.authoritativeSpeed !== vehicle.speed
    );
    rendered.authoritativeX = vehicle.x;
    rendered.authoritativeY = vehicle.y;
    rendered.authoritativeAngle = vehicle.angle;
    rendered.authoritativeSpeed = vehicle.speed;
    this.replayPresentation.observeAuthority('vehicle', vehicle.id, serverTimeMs);
    const wasLocalDriver = Boolean(rendered.localDriver);
    const becameLocalDriver = localDriver && !wasLocalDriver;
    rendered.localDriver = localDriver;
    if (!localDriver && serverTimeMs > 0) {
      if (wasLocalDriver) rendered.motion?.clear();
      rendered.motion?.push({
        timeMs: serverTimeMs,
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        velocityX: Math.cos(vehicle.angle) * vehicle.speed,
        velocityY: Math.sin(vehicle.angle) * vehicle.speed
      });
    }
    const acknowledgedSequence = playerList.find((player) => player.id === vehicle.driverId)
      ?.lastVehicleInputSequence ?? 0;
    const acknowledgementChanged = rendered.acknowledgedVehicleInputSequence !== acknowledgedSequence;
    if (becameLocalDriver) {
      rendered.predictedAngle = vehicle.angle;
      rendered.predictedSpeed = vehicle.speed;
      rendered.mesh.position.set(
        vehicle.x,
        serverYToThree(vehicle.y),
        this.surfaceHeightAt(vehicle.x, vehicle.y) + 3
      );
      rendered.mesh.rotation.z = serverVehicleAngleToThree(vehicle.angle);
      rendered.mesh.userData.positionInitialized = true;
      rendered.authorityDirty = false;
      rendered.vehiclePrediction?.initialize({
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.speed
      }, acknowledgedSequence);
      rendered.visualOffsetX = 0;
      rendered.visualOffsetY = 0;
      rendered.visualOffsetAngle = 0;
      rendered.acknowledgedVehicleInputSequence = acknowledgedSequence;
    } else if (
      localDriver &&
      (authorityChanged || acknowledgementChanged) &&
      rendered.interactionReplayAcknowledgedSequence !== acknowledgedSequence
    ) {
      const beforeX = rendered.mesh.position.x;
      const beforeY = serverYToThree(rendered.mesh.position.y);
      const beforeAngle = rendered.predictedAngle ?? vehicle.angle;
      const correction = rendered.vehiclePrediction?.reconcile({
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.speed
      }, acknowledgedSequence, vehicle.kind, (x, y, radius) => this.canOccupy(
        'street',
        x,
        y,
        radius
      ), vehicleMechanicalStepModifiers(
        vehicle.engineDamage,
        vehicle.onFire,
        vehicle.tyreDamageMask
      ));
      if (correction) {
        rendered.vehicleCorrection = correction;
        const offset = positionCorrectionOffset(
          beforeX,
          beforeY,
          correction.pose.x,
          correction.pose.y,
          correction.hardCorrection
        );
        rendered.visualOffsetX = offset.x;
        rendered.visualOffsetY = offset.y;
        rendered.visualOffsetAngle = angleCorrectionOffset(
          beforeAngle,
          correction.pose.angle,
          correction.hardCorrection
        );
      }
      rendered.acknowledgedVehicleInputSequence = acknowledgedSequence;
    }
    if (rendered.interactionReplayAcknowledgedSequence === acknowledgedSequence) {
      rendered.interactionReplayAcknowledgedSequence = undefined;
      rendered.acknowledgedVehicleInputSequence = acknowledgedSequence;
    }
    const door = vehicleDoorPresentation(vehicle, playerList);
    setSpriteFrame(
      rendered.mesh,
      VEHICLE_DOOR_COLUMNS,
      VEHICLE_DOOR_ROWS,
      vehicleDoorAtlasFrame(vehicle, door.frame)
    );
    const interaction = this.replayPresentation.pose('vehicle', vehicle.id);
    const buffered = !interaction && !localDriver && !localOccupant &&
      this.remoteTimelinesEnabled()
      ? rendered.motion?.sample(renderServerTimeMs, estimatedServerTimeMs)
      : undefined;
    if (buffered) this.onRemoteTimeline?.(buffered);
    const x = interaction?.x ?? buffered?.x ?? vehicle.x;
    const y = interaction?.y ?? buffered?.y ?? vehicle.y;
    const angle = interaction?.angle ?? buffered?.angle ?? vehicle.angle;
    const z = this.surfaceHeightAt(x, y) + 3;
    if (!localDriver) {
      positionEntity(rendered.mesh, x, y, z, buffered ? 1 : 0.3);
      rendered.mesh.rotation.z = rotateTowards(
        rendered.mesh.rotation.z,
        serverVehicleAngleToThree(angle),
        buffered ? 1 : 0.2
      );
      rendered.predictedAngle = angle;
      rendered.predictedSpeed = interaction?.speed ?? vehicle.speed;
    }
    rendered.mesh.visible = true;
    rendered.mesh.material.opacity = visual.alpha;
    rendered.mesh.material.color.setHex(visual.tint ?? 0xffffff);
    rendered.mesh.userData.worldX = x;
    rendered.mesh.userData.worldY = y;
    rendered.mesh.userData.vehicle = vehicle;
    this.positionVehicleEffects(rendered, vehicle);
  }

  private positionVehicleEffects(rendered: RenderedEntity, vehicle: NetworkVehicle): void {
    const frontLamp = renderedVehicleLampAnchor(
      rendered.mesh.position.x,
      rendered.mesh.position.y,
      rendered.mesh.rotation.z,
      52
    );
    const rearLamp = renderedVehicleLampAnchor(
      rendered.mesh.position.x,
      rendered.mesh.position.y,
      rendered.mesh.rotation.z,
      -34
    );
    if (rendered.headlight) {
      rendered.headlight.position.set(
        frontLamp.x,
        frontLamp.y,
        rendered.mesh.position.z + 1
      );
      rendered.headlight.rotation.z = frontLamp.rotation;
      rendered.headlight.scale.set(1.45, 0.52, 1);
    }
    if (rendered.taillight) {
      rendered.taillight.position.set(
        rearLamp.x,
        rearLamp.y,
        rendered.mesh.position.z + 1
      );
      rendered.taillight.rotation.z = rearLamp.rotation;
      rendered.taillight.scale.set(1.15, 0.52, 1);
    }
    const angle = frontLamp.rotation;
    const emergency = emergencyLightPresentation(vehicle, performance.now());
    const rightX = -Math.sin(angle);
    const rightY = Math.cos(angle);
    if (rendered.emergencyRed) {
      rendered.emergencyRed.position.set(
        rendered.mesh.position.x - rightX * 8,
        rendered.mesh.position.y - rightY * 8,
        rendered.mesh.position.z + 3
      );
      rendered.emergencyRed.visible = emergency.active;
      updateRadialGlow(rendered.emergencyRed, 0xff303f, emergency.redOpacity);
    }
    if (rendered.emergencyBlue) {
      rendered.emergencyBlue.position.set(
        rendered.mesh.position.x + rightX * 8,
        rendered.mesh.position.y + rightY * 8,
        rendered.mesh.position.z + 3
      );
      rendered.emergencyBlue.visible = emergency.active;
      updateRadialGlow(rendered.emergencyBlue, 0x3c73ff, emergency.blueOpacity);
    }
    if (rendered.smoke) {
      rendered.smoke.position.set(
        rendered.mesh.position.x - 14,
        rendered.mesh.position.y + 7,
        rendered.mesh.position.z + 8
      );
      const visual = vehicleVisualState(vehicle);
      rendered.smoke.visible = visual.smoke && !visual.fire;
      const pulse = 0.85 + Math.sin(performance.now() / 170) * 0.18;
      rendered.smoke.scale.setScalar(pulse);
      updateFireSmokeEffect(rendered.smoke, performance.now(), visual.smoke ? 0.9 : 0, vehicle.id.length);
    }
    if (rendered.fire) {
      rendered.fire.position.set(
        rendered.mesh.position.x - 10,
        rendered.mesh.position.y + 5,
        rendered.mesh.position.z + 9
      );
      const visual = vehicleVisualState(vehicle);
      rendered.fire.visible = visual.fire;
      rendered.fire.scale.setScalar(0.82 + Math.sin(performance.now() / 65) * 0.2);
      updateFireSmokeEffect(rendered.fire, performance.now(), visual.fire ? 1 : 0, vehicle.id.length);
    }
  }

  private obtain(id: string, create: () => RenderedEntity): RenderedEntity {
    let rendered = this.rendered.get(id);
    if (rendered) return rendered;
    rendered = create();
    this.rendered.set(id, rendered);
    this.scene.add(rendered.mesh);
    if (rendered.label) this.scene.add(rendered.label);
    if (rendered.weapon) this.scene.add(rendered.weapon);
    if (rendered.smoke) this.scene.add(rendered.smoke);
    if (rendered.fire) this.scene.add(rendered.fire);
    if (rendered.blood) this.scene.add(rendered.blood);
    if (rendered.headlight) this.scene.add(rendered.headlight);
    if (rendered.taillight) this.scene.add(rendered.taillight);
    if (rendered.emergencyRed) this.scene.add(rendered.emergencyRed);
    if (rendered.emergencyBlue) this.scene.add(rendered.emergencyBlue);
    return rendered;
  }

  private remove(id: string, rendered: RenderedEntity): void {
    const separator = id.indexOf(':');
    const rendererKind = separator >= 0 ? id.slice(0, separator) : '';
    const entityId = separator >= 0 ? id.slice(separator + 1) : id;
    if (rendererKind === 'player') this.replayPresentation.remove('player', entityId);
    else if (rendererKind === 'npc') this.replayPresentation.remove('pedestrian', entityId);
    else if (rendererKind === 'vehicle') this.replayPresentation.remove('vehicle', entityId);
    this.scene.remove(rendered.mesh);
    rendered.mesh.geometry.dispose();
    rendered.mesh.material.map?.dispose();
    rendered.mesh.material.dispose();
    if (rendered.label) {
      this.scene.remove(rendered.label);
      rendered.label.geometry.dispose();
      rendered.label.material.map?.dispose();
      rendered.label.material.dispose();
    }
    for (const effect of [
      rendered.weapon, rendered.smoke, rendered.fire, rendered.blood,
      rendered.headlight, rendered.taillight, rendered.emergencyRed, rendered.emergencyBlue
    ]) {
      if (!effect) continue;
      this.scene.remove(effect);
      disposeObjectTree(effect);
    }
    this.rendered.delete(id);
  }

  private appearanceTextureSet(player: NetworkPlayer): CompiledAppearanceTextures {
    const lpcRecipe = parseLpcRecipe(player.appearance.lpcRecipe);
    if (lpcRecipe) {
      const compiledKey = `lpc:${player.appearance.lpcRecipe}`;
      const cached = this.appearances.get(compiledKey);
      if (cached) return cached;
      const compiled = compileLpcCharacterSpriteSet(this.lpcSources, lpcRecipe);
      const walk = new THREE.CanvasTexture(compiled.walk);
      const actions = new THREE.CanvasTexture(compiled.actions);
      configureTexture(walk);
      configureTexture(actions);
      const textures = {
        walk,
        walkColumns: 9,
        walkRows: 4,
        directionalWalk: true,
        actions,
        actionsColumns: ACTION_SPRITE_COLUMNS,
        actionsRows: ACTION_SPRITE_ROWS
      };
      this.appearances.set(compiledKey, textures);
      this.trimAppearanceCache(compiledKey);
      return textures;
    }
    const presentation = appearanceSpritePresentation(player.appearance);
    const cached = this.appearances.get(presentation.textureKey);
    if (cached) return cached;
    if (this.textures.playerDirectionalWalk) {
      const textures = {
        walk: this.textures.player,
        walkColumns: this.textures.playerWalkColumns,
        walkRows: this.textures.playerWalkRows,
        directionalWalk: true,
        actions: this.textures.playerActions,
        actionsColumns: ACTION_SPRITE_COLUMNS,
        actionsRows: ACTION_SPRITE_ROWS
      };
      this.appearances.set(presentation.textureKey, textures);
      return textures;
    }
    const compiled = compileCharacterSpriteSet({
      walk: this.textures.player.image as CanvasImageSource,
      actions: this.textures.playerActions.image as CanvasImageSource,
      walkMask: this.textures.playerWalkMask.image as CanvasImageSource,
      actionsMask: this.textures.playerActionMask.image as CanvasImageSource
    }, player.appearance);
    const walk = new THREE.CanvasTexture(compiled.walk);
    const actions = new THREE.CanvasTexture(compiled.actions);
    configureTexture(walk);
    configureTexture(actions);
    const textures = {
      walk,
      walkColumns: this.textures.playerWalkColumns,
      walkRows: this.textures.playerWalkRows,
      directionalWalk: false,
      actions,
      actionsColumns: ACTION_SPRITE_COLUMNS,
      actionsRows: ACTION_SPRITE_ROWS
    };
    this.appearances.set(presentation.textureKey, textures);
    this.trimAppearanceCache(presentation.textureKey);
    return textures;
  }

  private trimAppearanceCache(protectedKey: string): void {
    if (this.appearances.size <= MAX_COMPILED_APPEARANCES) return;
    const activeKeys = new Set(
      [...this.rendered.values()].map((entity) => entity.appearanceKey).filter(Boolean)
    );
    for (const [key, textures] of this.appearances) {
      if (this.appearances.size <= MAX_COMPILED_APPEARANCES) break;
      if (key === protectedKey || activeKeys.has(key)) continue;
      textures.walk.dispose();
      textures.actions.dispose();
      this.appearances.delete(key);
    }
  }
}

function playerCharacterSources(): PlayerCharacterSources {
  const search = new URLSearchParams(window.location.search);
  const requested = search.get('lpc');
  if (requested === '1') window.localStorage.setItem(LPC_SPIKE_STORAGE_KEY, '1');
  if (requested === '0') window.localStorage.removeItem(LPC_SPIKE_STORAGE_KEY);
  const enabled = requested === '1' ||
    (requested !== '0' && window.localStorage.getItem(LPC_SPIKE_STORAGE_KEY) === '1');
  if (enabled) return LPC_SPIKE_ATLASES;
  return {
    walk: CHARACTER_ATLASES.walk.source,
    walkColumns: CHARACTER_ATLASES.walk.columns,
    walkRows: CHARACTER_ATLASES.walk.rows,
    directionalWalk: false,
    actions: CHARACTER_ATLASES.actions.source,
    walkMask: CHARACTER_ATLASES.walk.materialMask,
    actionMask: CHARACTER_ATLASES.actions.materialMask
  };
}

function spriteMesh(
  source: THREE.Texture,
  columns: number,
  rows: number,
  frame: number,
  width: number,
  height: number
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const texture = source.clone();
  texture.needsUpdate = true;
  texture.repeat.set(1 / columns, 1 / rows);
  const frameRow = Math.floor(frame / columns);
  texture.offset.set((frame % columns) / columns, 1 - (frameRow + 1) / rows);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 10;
  return mesh;
}

function policeStingerMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 48;
  const texture = new THREE.CanvasTexture(canvas);
  configureTexture(texture);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(104, 13), material);
  mesh.renderOrder = 13;
  paintPoliceStinger(mesh, 0, 'preparing');
  return mesh;
}

function paintPoliceStinger(
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  activeSegmentCount: number,
  phase: NetworkStinger['phase']
): void {
  const canvas = mesh.material.map?.image as HTMLCanvasElement | undefined;
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const count = Math.max(0, Math.min(POLICE_STINGER_SEGMENT_COUNT, activeSegmentCount));
  const spacing = 30;
  const startX = (canvas.width - (POLICE_STINGER_SEGMENT_COUNT - 1) * spacing) / 2;
  const metal = phase === 'retiring' ? '#6f6256' : phase === 'deploying' ? '#a98935' : '#4d555d';
  for (let index = 0; index < count; index++) {
    const x = startX + index * spacing;
    context.fillStyle = 'rgba(0, 0, 0, 0.65)';
    context.fillRect(x - 12, 15, 24, 20);
    context.fillStyle = metal;
    context.fillRect(x - 10, 13, 20, 18);
    context.fillStyle = '#bcc3c8';
    context.fillRect(x - 7, 20, 14, 3);
    context.fillStyle = '#e0d7b0';
    context.beginPath();
    context.moveTo(x, 5);
    context.lineTo(x + 4, 17);
    context.lineTo(x - 4, 17);
    context.closePath();
    context.fill();
  }
  if (mesh.material.map) mesh.material.map.needsUpdate = true;
  mesh.userData.activeSegmentCount = count;
  mesh.userData.stingerPhase = phase;
}

function weaponPlaneGeometry(
  presentation: ReturnType<typeof weaponPresentation>
): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(presentation.width, presentation.height);
  geometry.translate((0.5 - presentation.originX) * presentation.width, 0, 0);
  return geometry;
}

function nameLabel(name: string): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Nameplate canvas is unavailable.');
  context.font = '700 20px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 5;
  context.strokeStyle = 'rgba(0,0,0,0.9)';
  context.strokeText(name, 128, 24);
  context.fillStyle = '#ffffff';
  context.fillText(name, 128, 24);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(128, 24), material);
  mesh.renderOrder = 20;
  return mesh;
}

function disposeObjectTree(object: THREE.Object3D): void {
  object.traverse((entry) => {
    if (!(entry instanceof THREE.Mesh)) return;
    entry.geometry.dispose();
    const materials = Array.isArray(entry.material) ? entry.material : [entry.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
      material.dispose();
    }
  });
}

function replaceTexture(
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  source: THREE.Texture
): void {
  mesh.material.map?.dispose();
  const texture = source.clone();
  texture.needsUpdate = true;
  texture.repeat.copy(source.repeat);
  texture.offset.copy(source.offset);
  mesh.material.map = texture;
  mesh.material.needsUpdate = true;
}

function setSpriteSheet(
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  source: THREE.Texture,
  columns: number,
  rows: number,
  frame: number,
  sheetKey = source.uuid
): void {
  if (mesh.userData.sheetKey !== sheetKey) {
    replaceTexture(mesh, source);
    mesh.userData.sheetKey = sheetKey;
    mesh.userData.frame = undefined;
  }
  setSpriteFrame(mesh, columns, rows, frame);
}

function setSpriteFrame(
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  columns: number,
  rows: number,
  frame: number
): void {
  if (mesh.userData.frame === frame &&
    mesh.userData.columns === columns && mesh.userData.rows === rows) return;
  const texture = mesh.material.map;
  if (!texture) return;
  const frameRow = Math.floor(frame / columns);
  texture.repeat.set(1 / columns, 1 / rows);
  texture.offset.set((frame % columns) / columns, 1 - (frameRow + 1) / rows);
  mesh.userData.frame = frame;
  mesh.userData.columns = columns;
  mesh.userData.rows = rows;
}

function positionEntity(
  mesh: THREE.Mesh,
  x: number,
  y: number,
  z: number,
  factor: number
): void {
  const target = new THREE.Vector3(x, serverYToThree(y), z);
  if (!mesh.userData.positionInitialized || mesh.position.distanceTo(target) > 600) {
    mesh.position.copy(target);
    mesh.userData.positionInitialized = true;
  } else {
    mesh.position.lerp(target, factor);
  }
}

function updateWalkingFrame(
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  x: number,
  y: number,
  canWalk: boolean,
  columns = 3,
  rows = 3,
  directional = false,
  directionRowOverride?: number
): boolean {
  const now = performance.now();
  const previousX = mesh.userData.networkX as number | undefined;
  const previousY = mesh.userData.networkY as number | undefined;
  const deltaX = previousX === undefined ? 0 : x - previousX;
  const deltaY = previousY === undefined ? 0 : y - previousY;
  if (directional && directionRowOverride !== undefined) {
    mesh.userData.walkDirectionRow = directionRowOverride;
  }
  if (previousX !== undefined && previousY !== undefined && Math.hypot(deltaX, deltaY) > 0.35) {
    mesh.userData.movingUntil = now + 180;
    if (directional && directionRowOverride === undefined) {
      mesh.userData.walkDirectionRow = lpcDirectionRow(deltaX, deltaY);
    }
  }
  mesh.userData.networkX = x;
  mesh.userData.networkY = y;
  const moving = canWalk && now < Number(mesh.userData.movingUntil ?? 0);
  const directionRow = directional ? Number(mesh.userData.walkDirectionRow ?? 2) : 0;
  const frameColumn = moving ? 1 + Math.floor(now / 105) % Math.max(1, columns - 1) : 0;
  const frame = directional ? directionRow * columns + frameColumn : frameColumn;
  setSpriteFrame(mesh, columns, rows, frame);
  return moving;
}

function lpcDirectionRow(deltaX: number, deltaY: number): number {
  if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX < 0 ? 1 : 3;
  return deltaY < 0 ? 0 : 2;
}

function lpcAimDirectionRow(angle: number): number {
  return lpcDirectionRow(Math.cos(angle), Math.sin(angle));
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function initializedOnFootPrediction(
  player: NetworkPlayer,
  stepper: ConstructorParameters<typeof SavedOnFootPrediction>[0]
): SavedOnFootPrediction {
  const prediction = new SavedOnFootPrediction(stepper);
  prediction.initialize(
    {x: player.x, y: player.y, spaceId: player.spaceId || 'street'},
    player.lastInputSequence ?? 0
  );
  return prediction;
}

function configureTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.flipY = true;
}

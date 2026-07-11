import * as THREE from 'three';
import type {
  DistrictNetworkState,
  NetworkNpc,
  NetworkPlayer,
  NetworkVehicle
} from '../types.ts';
import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  appearanceSpritePresentation,
} from '../appearance/appearance-render-policy.ts';
import {compileCharacterSpriteSet} from '../appearance/character-sprite-compiler.ts';
import {CHARACTER_ATLASES} from '../../../shared/content/character-animation-manifest.ts';
import {
  meleeAttackPresentationAtProgress,
  passengerPresentation,
  weaponPresentation
} from '../rendering/player-render-policy.ts';
import {pedestrianMotionPresentation} from '../rendering/pedestrian-render-policy.ts';
import {combatReactionPresentation} from '../rendering/combat-reaction-render-policy.ts';
import {npcMeleePresentation} from '../rendering/npc-melee-render-policy.ts';
import {rotateTowards} from '../rendering/interpolation-policy.ts';
import {vehicleVisualState} from '../rendering/vehicle-render-policy.ts';
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
  serverYToThree
} from './three-prototype-policy.ts';

interface RenderedEntity {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  label?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  weapon?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  weaponOverlay?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  smoke?: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  fire?: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  blood?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  appearanceKey?: string;
  attackSequence?: number;
  attackWeapon?: NetworkPlayer['weapon'];
  attackCombo?: number;
  spriteKey?: string;
  vehicleActionKey?: string;
  vehicleActionStartedAt?: number;
  ejectionToken?: number;
  ejectionStartedAt?: number;
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
  lpcPistolOverlay: THREE.Texture;
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
const LPC_PISTOL_OVERLAY_COLUMNS = 8;

export class ThreeDistrictEntities {
  private readonly rendered = new Map<string, RenderedEntity>();
  private readonly appearances = new Map<string, CompiledAppearanceTextures>();

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly textures: EntityTextures,
    private readonly surfaceHeightAt: (x: number, y: number) => number
  ) {}

  static async create(
    scene: THREE.Scene,
    surfaceHeightAt: (x: number, y: number) => number
  ): Promise<ThreeDistrictEntities> {
    const loader = new THREE.TextureLoader();
    const characterSources = playerCharacterSources();
    const [
      player, civilian, police, vehicles, playerActions, playerWalkMask, playerActionMask,
      civilianActions, policeActions,
      vehicleDoors, blood, lpcPistolOverlay, fists, bat, pistol, smg, shotgun, rocket, grenade
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
      loader.loadAsync('/assets/custom/lpc-spike/player-lpc-pistol-8dir.png'),
      loader.loadAsync('/assets/original/weapons/fists.svg'),
      loader.loadAsync('/assets/original/weapons/bat.svg'),
      loader.loadAsync('/assets/original/weapons/pistol.svg'),
      loader.loadAsync('/assets/original/weapons/smg.svg'),
      loader.loadAsync('/assets/original/weapons/shotgun.svg'),
      loader.loadAsync('/assets/original/weapons/rocket.svg'),
      loader.loadAsync('/assets/original/weapons/grenade.svg')
    ]);
    for (const texture of [
      player, civilian, police, vehicles, playerActions, playerWalkMask, playerActionMask,
      civilianActions, policeActions,
      vehicleDoors, blood, lpcPistolOverlay, fists, bat, pistol, smg, shotgun, rocket, grenade
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
        vehicleDoors, blood, lpcPistolOverlay, weapons: {fists, bat, pistol, smg, shotgun, rocket, grenade}
      },
      surfaceHeightAt
    );
  }

  synchronize(state: DistrictNetworkState, localSpaceId = 'street'): void {
    const present = new Set<string>();
    state.players.forEach((player, id) => {
      if ((player.spaceId || 'street') !== localSpaceId) return;
      present.add(`player:${id}`);
      this.synchronizePlayer(`player:${id}`, player, state);
    });
    state.npcs.forEach((npc, id) => {
      if (localSpaceId !== 'street') return;
      present.add(`npc:${id}`);
      this.synchronizeNpc(`npc:${id}`, npc);
    });
    state.vehicles.forEach((vehicle, id) => {
      if (localSpaceId !== 'street') return;
      present.add(`vehicle:${id}`);
      this.synchronizeVehicle(`vehicle:${id}`, vehicle, state.players.values());
    });
    for (const [id, rendered] of this.rendered) {
      if (present.has(id)) continue;
      this.remove(id, rendered);
    }
  }

  destroy(): void {
    for (const [id, rendered] of this.rendered) this.remove(id, rendered);
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
      this.textures.lpcPistolOverlay,
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
    state: DistrictNetworkState
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
        weaponOverlay: spriteMesh(
          this.textures.lpcPistolOverlay,
          LPC_PISTOL_OVERLAY_COLUMNS,
          1,
          0,
          58,
          58
        ),
        blood: spriteMesh(this.textures.blood, 4, 1, 3, 64, 64),
        appearanceKey: appearance.textureKey
      };
    });
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
    const passenger = vehicle && player.vehicleSeat > 0
      ? passengerPresentation(vehicle, player.vehicleSeat, player.angle, performance.now(), false)
      : undefined;
    const x = passenger?.spriteX ?? player.x;
    const y = passenger?.spriteY ?? player.y;
    const z = this.surfaceHeightAt(x, y) + (passenger ? 8 : 4);
    positionEntity(rendered.mesh, x, y, z, 0.34);
    const bodyRotation = appearanceTextures.directionalWalk
      ? 0
      : serverPedestrianAngleToThree(player.angle) -
        (reaction.active ? reaction.rotationOffset : (melee?.bodyRotationOffset ?? 0));
    rendered.mesh.rotation.z = appearanceTextures.directionalWalk
      ? bodyRotation
      : reaction.active || melee?.active
        ? bodyRotation
        : rotateTowards(rendered.mesh.rotation.z, bodyRotation, 0.22);
    const bodyScale = passenger?.scale ?? 1;
    const bodyScaleX = reaction.active ? reaction.scaleX : (melee?.bodyScaleX ?? 1);
    const bodyScaleY = reaction.active ? reaction.scaleY : (melee?.bodyScaleY ?? 1);
    rendered.mesh.scale.set(
      bodyScale * appearance.bodyScaleX * bodyScaleX,
      bodyScale * bodyScaleY,
      bodyScale
    );
    rendered.mesh.material.color.setHex(reaction.tint ?? 0xffffff);
    rendered.mesh.visible = !vehicle || player.vehicleSeat > 0;
    if (actionSprite.sprite === 'walk') {
      updateWalkingFrame(
        rendered.mesh,
        player.x,
        player.y,
        Boolean(!vehicle && player.alive && !player.action && !melee?.active && !reaction.stopMovement),
        appearanceTextures.walkColumns,
        appearanceTextures.walkRows,
        appearanceTextures.directionalWalk
      );
    }
    if (rendered.blood) {
      rendered.blood.position.set(player.x, serverYToThree(player.y), this.surfaceHeightAt(player.x, player.y) + 2);
      rendered.blood.visible = !player.alive && !vehicle;
    }
    if (rendered.weaponOverlay) {
      const integratedPistol = appearanceTextures.directionalWalk &&
        player.weapon === 'pistol' &&
        rendered.mesh.visible &&
        held.visible &&
        !reaction.active &&
        (!player.action || player.action === 'melee');
      rendered.weaponOverlay.visible = integratedPistol;
      if (integratedPistol) {
        rendered.weaponOverlay.position.copy(rendered.mesh.position);
        rendered.weaponOverlay.position.z += 0.35;
        rendered.weaponOverlay.rotation.z = 0;
        rendered.weaponOverlay.scale.copy(rendered.mesh.scale);
        setSpriteFrame(
          rendered.weaponOverlay,
          LPC_PISTOL_OVERLAY_COLUMNS,
          1,
          pistolAimSector(player.angle)
        );
      }
    }
    if (rendered.weapon) {
      const baseX = passenger?.baseX ?? player.x;
      const baseY = passenger?.baseY ?? player.y;
      const weaponAngle = player.angle + (melee?.weaponRotationOffset ?? 0);
      const weaponDistance = melee?.active ? melee.weaponDistance : 8;
      rendered.weapon.position.set(
        baseX + Math.cos(weaponAngle) * weaponDistance,
        serverYToThree(baseY + Math.sin(weaponAngle) * weaponDistance),
        z + 2
      );
      rendered.weapon.rotation.z = serverAngleToThree(weaponAngle);
      rendered.weapon.visible = !rendered.weaponOverlay?.visible && rendered.mesh.visible && held.visible &&
        !reaction.active &&
        (!player.action || player.action === 'melee');
    }
    if (rendered.label) {
      const labelX = vehicle?.x ?? player.x;
      const labelY = vehicle?.y ?? player.y;
      const labelZ = this.surfaceHeightAt(labelX, labelY) + 12;
      rendered.label.position.set(
        labelX,
        serverYToThree(labelY) + 40 + Math.max(0, player.vehicleSeat) * 13,
        labelZ
      );
      rendered.label.visible = player.alive;
    }
  }

  private synchronizeNpc(id: string, npc: NetworkNpc): void {
    const texture = npc.kind === 'police' ? this.textures.police : this.textures.civilian;
    const rendered = this.obtain(id, () => ({
      mesh: spriteMesh(texture, 3, 3, 0, 54, 54),
      blood: spriteMesh(this.textures.blood, 4, 1, 3, 60, 60),
      spriteKey: 'walk'
    }));
    positionEntity(
      rendered.mesh,
      npc.x,
      npc.y,
      this.surfaceHeightAt(npc.x, npc.y) + 3,
      0.28
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
    const bodyRotation = serverPedestrianAngleToThree(npc.angle) - rotationOffset;
    rendered.mesh.rotation.z = reaction.active || melee.active
      ? bodyRotation
      : rotateTowards(rendered.mesh.rotation.z, bodyRotation, 0.18);
    rendered.mesh.scale.set(scaleX, scaleY, 1);
    rendered.mesh.visible = true;
    const moving = actionSprite.sprite === 'walk' && updateWalkingFrame(
      rendered.mesh,
      npc.x,
      npc.y,
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
      rendered.blood.position.set(npc.x, serverYToThree(npc.y), this.surfaceHeightAt(npc.x, npc.y) + 2);
      rendered.blood.visible = !npc.alive || npc.action === 'dead';
    }
  }

  private synchronizeVehicle(
    id: string,
    vehicle: NetworkVehicle,
    players: Iterable<NetworkPlayer>
  ): void {
    const definition = vehicleDefinition(vehicle.kind);
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
      smoke: effectDisc(11, 0x3b4244, 0.72),
      fire: effectDisc(7, 0xff7a24, 0.92)
    }));
    const door = vehicleDoorPresentation(vehicle, players);
    setSpriteFrame(
      rendered.mesh,
      VEHICLE_DOOR_COLUMNS,
      VEHICLE_DOOR_ROWS,
      vehicleDoorAtlasFrame(vehicle, door.frame)
    );
    const z = this.surfaceHeightAt(vehicle.x, vehicle.y) + 3;
    positionEntity(rendered.mesh, vehicle.x, vehicle.y, z, 0.3);
    rendered.mesh.rotation.z = rotateTowards(
      rendered.mesh.rotation.z,
      serverVehicleAngleToThree(vehicle.angle),
      0.2
    );
    rendered.mesh.visible = true;
    rendered.mesh.material.opacity = visual.alpha;
    rendered.mesh.material.color.setHex(visual.tint ?? 0xffffff);
    if (rendered.smoke) {
      rendered.smoke.position.set(vehicle.x - 12, serverYToThree(vehicle.y) + 5, z + 4);
      rendered.smoke.visible = visual.smoke;
      const pulse = 0.85 + Math.sin(performance.now() / 170) * 0.18;
      rendered.smoke.scale.setScalar(pulse);
    }
    if (rendered.fire) {
      rendered.fire.position.set(vehicle.x - 9, serverYToThree(vehicle.y) + 4, z + 5);
      rendered.fire.visible = visual.fire;
      rendered.fire.scale.setScalar(0.82 + Math.sin(performance.now() / 65) * 0.2);
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
    if (rendered.weaponOverlay) this.scene.add(rendered.weaponOverlay);
    if (rendered.smoke) this.scene.add(rendered.smoke);
    if (rendered.fire) this.scene.add(rendered.fire);
    if (rendered.blood) this.scene.add(rendered.blood);
    return rendered;
  }

  private remove(id: string, rendered: RenderedEntity): void {
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
    for (const effect of [rendered.weapon, rendered.weaponOverlay, rendered.smoke, rendered.fire, rendered.blood]) {
      if (!effect) continue;
      this.scene.remove(effect);
      effect.geometry.dispose();
      effect.material.map?.dispose();
      effect.material.dispose();
    }
    this.rendered.delete(id);
  }

  private appearanceTextureSet(player: NetworkPlayer): CompiledAppearanceTextures {
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

function effectDisc(
  radius: number,
  color: number,
  opacity: number
): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 18), material);
  mesh.renderOrder = 12;
  return mesh;
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
  directional = false
): boolean {
  const now = performance.now();
  const previousX = mesh.userData.networkX as number | undefined;
  const previousY = mesh.userData.networkY as number | undefined;
  const deltaX = previousX === undefined ? 0 : x - previousX;
  const deltaY = previousY === undefined ? 0 : y - previousY;
  if (previousX !== undefined && previousY !== undefined && Math.hypot(deltaX, deltaY) > 0.35) {
    mesh.userData.movingUntil = now + 180;
    if (directional) {
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

function pistolAimSector(angle: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = ((angle % fullTurn) + fullTurn) % fullTurn;
  return Math.round(normalized / (Math.PI / 4)) % LPC_PISTOL_OVERLAY_COLUMNS;
}

function configureTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.flipY = true;
}

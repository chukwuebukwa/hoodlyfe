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
  renderAppearanceSheet
} from '../appearance/appearance-render-policy.ts';
import {
  meleeAttackPresentationAtProgress,
  passengerPresentation,
  weaponPresentation
} from '../rendering/player-render-policy.ts';
import {pedestrianMotionPresentation} from '../rendering/pedestrian-render-policy.ts';
import {combatReactionPresentation} from '../rendering/combat-reaction-render-policy.ts';
import {rotateTowards} from '../rendering/interpolation-policy.ts';
import {vehicleVisualState} from '../rendering/vehicle-render-policy.ts';
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
  smoke?: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  fire?: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  appearanceKey?: string;
  attackSequence?: number;
  attackWeapon?: NetworkPlayer['weapon'];
  attackCombo?: number;
}

interface EntityTextures {
  player: THREE.Texture;
  civilian: THREE.Texture;
  police: THREE.Texture;
  vehicles: THREE.Texture;
  weapons: Record<NetworkPlayer['weapon'], THREE.Texture>;
}

export class ThreeDistrictEntities {
  private readonly rendered = new Map<string, RenderedEntity>();
  private readonly appearances = new Map<string, THREE.Texture>();

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
    const [player, civilian, police, vehicles, fists, bat, pistol, smg, shotgun, grenade] = await Promise.all([
      loader.loadAsync('/assets/original/sprites/player-base.png'),
      loader.loadAsync('/assets/original/sprites/civilian.png'),
      loader.loadAsync('/assets/original/sprites/police.png'),
      loader.loadAsync('/assets/original/sprites/vehicles.png'),
      loader.loadAsync('/assets/original/weapons/fists.svg'),
      loader.loadAsync('/assets/original/weapons/bat.svg'),
      loader.loadAsync('/assets/original/weapons/pistol.svg'),
      loader.loadAsync('/assets/original/weapons/smg.svg'),
      loader.loadAsync('/assets/original/weapons/shotgun.svg'),
      loader.loadAsync('/assets/original/weapons/grenade.svg')
    ]);
    for (const texture of [player, civilian, police, vehicles, fists, bat, pistol, smg, shotgun, grenade]) {
      configureTexture(texture);
    }
    return new ThreeDistrictEntities(
      scene,
      {player, civilian, police, vehicles, weapons: {fists, bat, pistol, smg, shotgun, grenade}},
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
      this.synchronizeVehicle(`vehicle:${id}`, vehicle);
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
      ...Object.values(this.textures.weapons)
    ]) texture.dispose();
    for (const texture of this.appearances.values()) texture.dispose();
    this.appearances.clear();
  }

  private synchronizePlayer(
    id: string,
    player: NetworkPlayer,
    state: DistrictNetworkState
  ): void {
    const appearance = appearanceSpritePresentation(player.appearance);
    const appearanceTexture = this.appearanceTexture(player);
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
        mesh: spriteMesh(appearanceTexture, 3, 3, 0, 58, 58),
        label: nameLabel(player.name),
        weapon,
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
    if (rendered.appearanceKey !== appearance.textureKey) {
      replaceTexture(rendered.mesh, appearanceTexture);
      rendered.appearanceKey = appearance.textureKey;
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
    const bodyRotation = serverPedestrianAngleToThree(player.angle) -
      (reaction.active ? reaction.rotationOffset : (melee?.bodyRotationOffset ?? 0));
    rendered.mesh.rotation.z = reaction.active || melee?.active
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
    rendered.mesh.visible = player.alive && (!vehicle || player.vehicleSeat > 0);
    updateWalkingFrame(
      rendered.mesh,
      player.x,
      player.y,
      Boolean(!vehicle && player.alive && !player.action && !melee?.active && !reaction.stopMovement)
    );
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
      rendered.weapon.visible = rendered.mesh.visible && held.visible &&
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
    const rendered = this.obtain(id, () => ({mesh: spriteMesh(texture, 3, 3, 0, 54, 54)}));
    positionEntity(
      rendered.mesh,
      npc.x,
      npc.y,
      this.surfaceHeightAt(npc.x, npc.y) + 3,
      0.28
    );
    const reaction = combatReactionPresentation(npc);
    const bodyRotation = serverPedestrianAngleToThree(npc.angle) - reaction.rotationOffset;
    rendered.mesh.rotation.z = reaction.active
      ? bodyRotation
      : rotateTowards(rendered.mesh.rotation.z, bodyRotation, 0.18);
    rendered.mesh.scale.set(reaction.scaleX, reaction.scaleY, 1);
    rendered.mesh.visible = npc.alive;
    const moving = updateWalkingFrame(
      rendered.mesh,
      npc.x,
      npc.y,
      npc.alive && !reaction.stopMovement
    );
    const presentation = pedestrianMotionPresentation(
      npc.action,
      moving ? 1 : 0,
      reaction.stopMovement
    );
    rendered.mesh.material.opacity = presentation.alpha;
    rendered.mesh.material.color.setHex(reaction.tint ?? presentation.tint ?? 0xffffff);
  }

  private synchronizeVehicle(id: string, vehicle: NetworkVehicle): void {
    const definition = vehicleDefinition(vehicle.kind);
    const visual = vehicleVisualState(vehicle);
    const rendered = this.obtain(id, () => ({
      mesh: spriteMesh(
        this.textures.vehicles,
        3,
        1,
        definition.presentation.frame,
        definition.presentation.width,
        definition.presentation.height
      ),
      smoke: effectDisc(11, 0x3b4244, 0.72),
      fire: effectDisc(7, 0xff7a24, 0.92)
    }));
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
    if (rendered.smoke) this.scene.add(rendered.smoke);
    if (rendered.fire) this.scene.add(rendered.fire);
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
    for (const effect of [rendered.weapon, rendered.smoke, rendered.fire]) {
      if (!effect) continue;
      this.scene.remove(effect);
      effect.geometry.dispose();
      effect.material.map?.dispose();
      effect.material.dispose();
    }
    this.rendered.delete(id);
  }

  private appearanceTexture(player: NetworkPlayer): THREE.Texture {
    const presentation = appearanceSpritePresentation(player.appearance);
    const cached = this.appearances.get(presentation.textureKey);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    const source = this.textures.player.image as CanvasImageSource;
    renderAppearanceSheet(source, canvas, player.appearance);
    const texture = new THREE.CanvasTexture(canvas);
    configureTexture(texture);
    this.appearances.set(presentation.textureKey, texture);
    return texture;
  }
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
  canWalk: boolean
): boolean {
  const now = performance.now();
  const previousX = mesh.userData.networkX as number | undefined;
  const previousY = mesh.userData.networkY as number | undefined;
  if (previousX !== undefined && previousY !== undefined &&
    Math.hypot(x - previousX, y - previousY) > 0.35) {
    mesh.userData.movingUntil = now + 180;
  }
  mesh.userData.networkX = x;
  mesh.userData.networkY = y;
  const moving = canWalk && now < Number(mesh.userData.movingUntil ?? 0);
  const frame = moving ? 1 + Math.floor(now / 105) % 8 : 0;
  const texture = mesh.material.map;
  if (texture && mesh.userData.frame !== frame) {
    texture.offset.set((frame % 3) / 3, 1 - (Math.floor(frame / 3) + 1) / 3);
    mesh.userData.frame = frame;
  }
  return moving;
}

function configureTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.flipY = true;
}

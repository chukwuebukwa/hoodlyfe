import * as THREE from 'three';
import {STREET_GROUND_SURFACE_ID} from '../../../shared/world/surface-map.ts';
import {projectMissionWorld} from '../missions/mission-presentation-policy.ts';
import {projectileStyle} from '../rendering/projectile-render-policy.ts';
import {signalLampPresentation} from '../rendering/traffic-signal-render-policy.ts';
import {thrownProjectilePresentation} from '../rendering/thrown-projectile-render-policy.ts';
import type {
  DistrictNetworkState,
  NetworkCashPickup,
  NetworkExplosion,
  NetworkStreetService,
  NetworkTrafficSignal,
  NetworkWeaponPickup
} from '../types.ts';
import {serverAngleToThree, serverYToThree} from './three-prototype-policy.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {radialGlow, updateRadialGlow} from './three-glow.ts';
import type {PredictedProjectilePresentation} from '../network/combat-fire-prediction-controller.ts';
import {createFireSmokeEffect, updateFireSmokeEffect} from './three-fire-smoke-effect.ts';

interface TimedExplosion {
  group: THREE.Group;
  startedAt: number;
  radius: number;
}

export class ThreeDistrictWorld {
  private readonly markers = new Map<string, THREE.Group>();
  private readonly bullets = new Map<string, THREE.Mesh>();
  private readonly predictedBullets = new Map<number, THREE.Mesh>();
  private readonly rockets = new Map<string, THREE.Group>();
  private readonly grenades = new Map<string, THREE.Group>();
  private readonly fires = new Map<string, THREE.Group>();
  private readonly explosions = new Map<string, TimedExplosion>();
  private readonly signals = new Map<string, THREE.Group>();
  private readonly grenadeTexture: THREE.Texture;
  private readonly molotovTexture: THREE.Texture;
  private readonly rocketTexture: THREE.Texture;

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly localPlayerId: string,
    private readonly surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number,
    grenadeTexture: THREE.Texture,
    molotovTexture: THREE.Texture,
    rocketTexture: THREE.Texture
  ) {
    this.grenadeTexture = grenadeTexture;
    this.molotovTexture = molotovTexture;
    this.rocketTexture = rocketTexture;
  }

  static async create(
    scene: THREE.Scene,
    localPlayerId: string,
    surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number
  ): Promise<ThreeDistrictWorld> {
    const loader = new THREE.TextureLoader();
    const [grenade, molotov, rocket] = await Promise.all([
      loader.loadAsync('/assets/original/weapons/grenade.svg'),
      loader.loadAsync('/assets/original/weapons/molotov.svg'),
      loader.loadAsync('/assets/original/weapons/rocket.svg')
    ]);
    for (const texture of [grenade, molotov, rocket]) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
    }
    return new ThreeDistrictWorld(scene, localPlayerId, surfaceHeightAt, grenade, molotov, rocket);
  }

  synchronize(state: DistrictNetworkState, nowMs: number, localSpaceId = 'street'): void {
    this.synchronizeMarkers(state, nowMs, localSpaceId);
    if (localSpaceId !== STREET_SPACE_ID) {
      this.clearStreetTransients();
      return;
    }
    this.synchronizeBullets(state);
    this.synchronizeRockets(state);
    this.synchronizeGrenades(state, nowMs);
    this.synchronizeFires(state, nowMs);
    this.synchronizeExplosions(state, nowMs);
    this.synchronizeSignals(state);
  }

  private clearStreetTransients(): void {
    for (const mesh of this.bullets.values()) disposeObject(mesh);
    for (const mesh of this.predictedBullets.values()) disposeObject(mesh);
    for (const group of this.rockets.values()) disposeObject(group);
    for (const group of this.grenades.values()) disposeObject(group);
    for (const group of this.fires.values()) disposeObject(group);
    for (const explosion of this.explosions.values()) disposeObject(explosion.group);
    for (const group of this.signals.values()) disposeObject(group);
    this.bullets.clear();
    this.predictedBullets.clear();
    this.rockets.clear();
    this.grenades.clear();
    this.fires.clear();
    this.explosions.clear();
    this.signals.clear();
  }

  destroy(): void {
    for (const group of this.markers.values()) disposeObject(group);
    for (const mesh of this.bullets.values()) disposeObject(mesh);
    for (const mesh of this.predictedBullets.values()) disposeObject(mesh);
    for (const group of this.rockets.values()) disposeObject(group);
    for (const group of this.grenades.values()) disposeObject(group);
    for (const group of this.fires.values()) disposeObject(group);
    for (const explosion of this.explosions.values()) disposeObject(explosion.group);
    for (const group of this.signals.values()) disposeObject(group);
    this.markers.clear();
    this.bullets.clear();
    this.predictedBullets.clear();
    this.rockets.clear();
    this.grenades.clear();
    this.fires.clear();
    this.explosions.clear();
    this.signals.clear();
    this.grenadeTexture.dispose();
    this.molotovTexture.dispose();
    this.rocketTexture.dispose();
  }

  private synchronizeMarkers(
    state: DistrictNetworkState,
    nowMs: number,
    localSpaceId: string
  ): void {
    const present = new Set<string>();
    for (const service of state.services?.values() ?? []) {
      if ((service.spaceId || STREET_SPACE_ID) !== localSpaceId) continue;
      const id = `service:${service.id}`;
      present.add(id);
      let group = this.markers.get(id);
      if (!group) {
        group = serviceMarker(service);
        this.addMarker(id, group);
      }
      positionAtSurface(
        group, service.x, service.y,
        this.surfaceHeightAt(service.x, service.y, STREET_GROUND_SURFACE_ID) + 7
      );
      pulseMarker(group, nowMs, service.id.length);
    }
    for (const pickup of localSpaceId === STREET_SPACE_ID
      ? state.weaponPickups?.values() ?? []
      : []) {
      if (!pickup.available) continue;
      const id = `pickup:${pickup.id}`;
      present.add(id);
      let group = this.markers.get(id);
      if (!group) {
        group = pickupMarker(
          pickup,
          pickup.weapon === 'molotov' ? this.molotovTexture : this.grenadeTexture
        );
        this.addMarker(id, group);
      }
      positionAtSurface(
        group, pickup.x, pickup.y,
        this.surfaceHeightAt(pickup.x, pickup.y, STREET_GROUND_SURFACE_ID) + 8
      );
      pulseMarker(group, nowMs, pickup.id.length);
    }
    for (const pickup of localSpaceId === STREET_SPACE_ID
      ? state.cashPickups?.values() ?? []
      : []) {
      const id = `cash:${pickup.id}`;
      present.add(id);
      let group = this.markers.get(id);
      if (!group) {
        group = cashMarker(pickup);
        this.addMarker(id, group);
      }
      positionAtSurface(
        group, pickup.x, pickup.y,
        this.surfaceHeightAt(pickup.x, pickup.y, STREET_GROUND_SURFACE_ID) + 8
      );
      pulseMarker(group, nowMs, pickup.id.length);
    }

    if (localSpaceId !== STREET_SPACE_ID) {
      removeAbsent(this.markers, present);
      return;
    }
    const mission = projectMissionWorld(state, this.localPlayerId);
    this.syncMissionMarker(present, 'mission:contact', mission.contact.x, mission.contact.y, 24, 0xff9d3f, 'FREEMODE', nowMs);
    if (mission.delivery) {
      this.syncMissionMarker(present, 'mission:delivery', mission.delivery.x, mission.delivery.y, mission.delivery.radius, 0x63df8a, 'DELIVERY', nowMs);
    }
    if (mission.checkpoint) {
      this.syncMissionMarker(present, 'mission:checkpoint', mission.checkpoint.x, mission.checkpoint.y, mission.checkpoint.radius, 0x55d6ff, 'CHECKPOINT', nowMs);
    }
    if (mission.hold) {
      this.syncMissionMarker(
        present,
        'mission:hold',
        mission.hold.x,
        mission.hold.y,
        mission.hold.radius,
        mission.hold.contested ? 0xff5e4d : 0x55d6ff,
        mission.hold.contested ? 'CONTESTED' : 'HOLD',
        nowMs
      );
    }
    if (mission.target) {
      this.syncMissionMarker(present, 'mission:target', mission.target.x, mission.target.y, 34, 0xf2c94c, 'TARGET', nowMs);
    }
    removeAbsent(this.markers, present);
  }

  private syncMissionMarker(
    present: Set<string>,
    id: string,
    x: number,
    y: number,
    radius: number,
    color: number,
    label: string,
    nowMs: number
  ): void {
    present.add(id);
    let group = this.markers.get(id);
    if (!group || group.userData.radius !== radius || group.userData.color !== color) {
      if (group) disposeObject(group);
      group = ringMarker(radius, color, label);
      group.userData.radius = radius;
      group.userData.color = color;
      this.addMarker(id, group);
    }
    positionAtSurface(
      group, x, y, this.surfaceHeightAt(x, y, STREET_GROUND_SURFACE_ID) + 7
    );
    pulseMarker(group, nowMs, id.length);
  }

  private addMarker(id: string, group: THREE.Group): void {
    this.markers.set(id, group);
    this.scene.add(group);
  }

  private synchronizeBullets(state: DistrictNetworkState): void {
    const present = new Set<string>();
    for (const [id, bullet] of state.bullets ?? []) {
      present.add(id);
      let mesh = this.bullets.get(id);
      if (!mesh) {
        const style = projectileStyle(bullet);
        mesh = disc(style.radius, style.color, 1, 25);
        this.bullets.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(
        bullet.x,
        serverYToThree(bullet.y),
        this.surfaceHeightAt(
          bullet.x,
          bullet.y,
          bullet.surfaceId ?? STREET_GROUND_SURFACE_ID
        ) + 12
      );
    }
    removeAbsent(this.bullets, present);
  }

  synchronizePredictedBullets(
    projectiles: readonly PredictedProjectilePresentation[],
    localSpaceId = STREET_SPACE_ID,
    surfaceId = STREET_GROUND_SURFACE_ID
  ): void {
    const present = new Set<number>();
    if (localSpaceId === STREET_SPACE_ID) {
      for (const projectile of projectiles) {
        present.add(projectile.clientSpawnId);
        let mesh = this.predictedBullets.get(projectile.clientSpawnId);
        if (!mesh) {
          const style = projectileStyle({ownerKind: 'player', weapon: projectile.weapon});
          mesh = disc(style.radius, style.color, 0.9, 25);
          this.predictedBullets.set(projectile.clientSpawnId, mesh);
          this.scene.add(mesh);
        }
        mesh.position.set(
          projectile.x,
          serverYToThree(projectile.y),
          this.surfaceHeightAt(projectile.x, projectile.y, surfaceId) + 12
        );
      }
    }
    for (const [clientSpawnId, mesh] of this.predictedBullets) {
      if (present.has(clientSpawnId)) continue;
      disposeObject(mesh);
      this.predictedBullets.delete(clientSpawnId);
    }
  }

  private synchronizeRockets(state: DistrictNetworkState): void {
    const present = new Set<string>();
    for (const [id, rocket] of state.rockets ?? []) {
      present.add(id);
      let group = this.rockets.get(id);
      if (!group) {
        const model = texturedPlane(this.rocketTexture, 35, 10, 27);
        const exhaust = disc(5, 0xff9a32, 0.9, 26);
        exhaust.position.x = -15;
        group = new THREE.Group();
        group.add(exhaust, model);
        this.rockets.set(id, group);
        this.scene.add(group);
      }
      group.position.set(
        rocket.x,
        serverYToThree(rocket.y),
        this.surfaceHeightAt(
          rocket.x,
          rocket.y,
          rocket.surfaceId ?? STREET_GROUND_SURFACE_ID
        ) + 14
      );
      group.rotation.z = serverAngleToThree(rocket.angle);
    }
    removeAbsent(this.rockets, present);
  }

  private synchronizeGrenades(state: DistrictNetworkState, nowMs: number): void {
    const present = new Set<string>();
    for (const [id, grenade] of state.thrownProjectiles ?? []) {
      present.add(id);
      let group = this.grenades.get(id);
      if (!group) {
        const shadow = disc(8, 0x050708, 0.42, 22);
        shadow.userData.role = 'shadow';
        const texture = grenade.kind === 'molotov' ? this.molotovTexture : this.grenadeTexture;
        const icon = texturedPlane(texture, grenade.kind === 'molotov' ? 14 : 16, grenade.kind === 'molotov' ? 24 : 16, 24);
        icon.userData.role = 'icon';
        group = new THREE.Group();
        group.add(shadow, icon);
        this.grenades.set(id, group);
        this.scene.add(group);
      }
      const ground = this.surfaceHeightAt(
        grenade.x,
        grenade.y,
        grenade.surfaceId ?? STREET_GROUND_SURFACE_ID
      ) + 8;
      group.position.set(grenade.x, serverYToThree(grenade.y), ground);
      const presentation = thrownProjectilePresentation(grenade, nowMs);
      const shadow = group.children.find((child) => child.userData.role === 'shadow');
      const icon = group.children.find((child) => child.userData.role === 'icon');
      shadow?.scale.setScalar(presentation.shadowScale);
      if (shadow instanceof THREE.Mesh) shadow.material.opacity = presentation.shadowAlpha;
      if (icon) {
        icon.position.z = Math.max(3, grenade.height);
        icon.scale.setScalar(presentation.modelScale);
        icon.rotation.z = serverAngleToThree(grenade.angle);
      }
    }
    removeAbsent(this.grenades, present);
  }

  private synchronizeFires(state: DistrictNetworkState, nowMs: number): void {
    const present = new Set<string>();
    for (const [id, fire] of state.fires ?? []) {
      present.add(id);
      let group = this.fires.get(id);
      if (!group) {
        group = createFireSmokeEffect({radius: fire.radius, seed: id.length});
        group.add(
          radialGlow(fire.radius * 1.55, 0xff5a24, 0.2, 20)
        );
        this.fires.set(id, group);
        this.scene.add(group);
      }
      positionAtSurface(
        group,
        fire.x,
        fire.y,
        this.surfaceHeightAt(
          fire.x, fire.y, fire.surfaceId ?? STREET_GROUND_SURFACE_ID
        ) + 10
      );
      const remaining = Math.max(0, fire.expiresAt - nowMs);
      const pulse = 0.88 + Math.sin(nowMs / 105 + id.length) * 0.12;
      const intensity = Math.min(1, remaining / 500);
      updateFireSmokeEffect(group, nowMs, intensity, id.length);
      group.scale.setScalar(pulse * intensity);
      group.rotation.z = Math.sin(nowMs / 230 + id.length) * 0.08;
    }
    removeAbsent(this.fires, present);
  }

  private synchronizeExplosions(state: DistrictNetworkState, nowMs: number): void {
    const present = new Set<string>();
    for (const [id, explosion] of state.explosions ?? []) {
      present.add(id);
      let rendered = this.explosions.get(id);
      if (!rendered) {
        rendered = this.createExplosion(explosion, nowMs);
        this.explosions.set(id, rendered);
        this.scene.add(rendered.group);
      }
      const progress = Math.min(1, (nowMs - rendered.startedAt) / 720);
      rendered.group.scale.setScalar(0.3 + progress * 1.35);
      updateFireSmokeEffect(rendered.group, nowMs, Math.max(0, 1 - progress), rendered.radius);
      rendered.group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
          object.material.opacity = Math.max(0, 1 - progress);
        }
      });
    }
    removeAbsentExplosions(this.explosions, present);
  }

  private createExplosion(explosion: NetworkExplosion, nowMs: number): TimedExplosion {
    const radius = Math.max(28, explosion.radius * 0.52);
    const group = createFireSmokeEffect({radius: radius * 0.9, seed: nowMs % 997, burst: true});
    group.add(
      radialGlow(radius * 1.35, 0xff6a24, 0.28, 26),
      ring(radius * 0.24, radius * 0.33, 0xffd167, 0.9, 27)
    );
    positionAtSurface(
      group,
      explosion.x,
      explosion.y,
      this.surfaceHeightAt(
        explosion.x,
        explosion.y,
        explosion.surfaceId ?? STREET_GROUND_SURFACE_ID
      ) + 15
    );
    return {group, startedAt: nowMs, radius};
  }

  private synchronizeSignals(state: DistrictNetworkState): void {
    const present = new Set<string>();
    for (const [id, signal] of state.trafficSignals ?? []) {
      present.add(id);
      let group = this.signals.get(id);
      if (!group) {
        group = signalMarker();
        this.signals.set(id, group);
        this.scene.add(group);
      }
      positionAtSurface(
        group, signal.x, signal.y,
        this.surfaceHeightAt(signal.x, signal.y, STREET_GROUND_SURFACE_ID) + 11
      );
      applySignal(group, signal);
    }
    removeAbsent(this.signals, present);
  }
}

function serviceMarker(service: NetworkStreetService): THREE.Group {
  const color = service.kind === 'repair'
    ? 0x55d6ff
    : service.kind === 'hospital'
      ? 0x63df8a
      : service.kind === 'clothing'
        ? 0xff7fb6
        : 0xf2c94c;
  return ringMarker(service.radius, color, service.label.toUpperCase());
}

function pickupMarker(pickup: NetworkWeaponPickup, texture: THREE.Texture): THREE.Group {
  const label = pickup.weapon === 'molotov' ? 'MOLOTOVS' : 'GRENADES';
  const group = ringMarker(20, 0xffd75a, `${label} x${pickup.quantity}`);
  const icon = texturedPlane(texture, pickup.weapon === 'molotov' ? 14 : 17, pickup.weapon === 'molotov' ? 24 : 17, 24);
  icon.position.z = 2;
  group.add(icon);
  return group;
}

function cashMarker(pickup: NetworkCashPickup): THREE.Group {
  const group = ringMarker(17, 0x55e58b, `$${Math.max(0, Math.floor(pickup.amount))}`);
  const glyph = textLabel('$', 0x55e58b);
  glyph.scale.setScalar(1.35);
  glyph.position.set(0, 0, 2);
  group.add(glyph);
  return group;
}

function ringMarker(radius: number, color: number, text: string): THREE.Group {
  const group = new THREE.Group();
  group.add(
    disc(radius, color, 0.06, 16),
    ring(Math.max(1, radius - 2), radius + 1, color, 0.9, 17)
  );
  const label = textLabel(text, color);
  label.position.set(0, radius + 18, 3);
  group.add(label);
  return group;
}

function signalMarker(): THREE.Group {
  const group = new THREE.Group();
  const housing = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 34),
    material(0x111719, 0.96, 18)
  );
  group.add(housing);
  const glow = radialGlow(92, 0xff394f, 0.12, 17);
  glow.position.z = -9;
  glow.userData.role = 'signal-glow';
  const cast = new THREE.PointLight(0xff394f, 1.1, 105, 2);
  cast.position.z = 13;
  cast.userData.role = 'signal-light';
  group.add(glow, cast);
  for (const [role, y, color] of [
    ['red', 10, 0xff394f],
    ['yellow', 0, 0xffcc3d],
    ['green', -10, 0x55e889]
  ] as const) {
    const lamp = disc(4, color, 0.2, 19);
    lamp.position.set(0, y, 1);
    lamp.userData.role = role;
    group.add(lamp);
  }
  return group;
}

function applySignal(group: THREE.Group, signal: NetworkTrafficSignal): void {
  const lamps = signalLampPresentation(signal.northSouth);
  for (const child of group.children) {
    if (child.userData.role === 'signal-glow' && child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial) {
      const color = signalPhaseColor(signal.northSouth);
      updateRadialGlow(child, color, signal.northSouth === 'yellow' ? 0.16 : 0.11);
      continue;
    }
    if (child.userData.role === 'signal-light' && child instanceof THREE.PointLight) {
      child.color.setHex(signalPhaseColor(signal.northSouth));
      child.intensity = signal.northSouth === 'yellow' ? 1.4 : 1.05;
      continue;
    }
    if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) continue;
    const role = child.userData.role as 'red' | 'yellow' | 'green' | undefined;
    if (role) child.material.opacity = lamps[role].alpha;
  }
}

function signalPhaseColor(phase: NetworkTrafficSignal['northSouth']): number {
  if (phase === 'green') return 0x55e889;
  if (phase === 'yellow') return 0xffcc3d;
  return 0xff394f;
}

function pulseMarker(group: THREE.Group, nowMs: number, phase: number): void {
  const pulse = 1 + Math.sin(nowMs / 190 + phase) * 0.035;
  group.scale.setScalar(pulse);
}

function positionAtSurface(group: THREE.Object3D, x: number, y: number, z: number): void {
  group.position.set(x, serverYToThree(y), z);
}

function texturedPlane(texture: THREE.Texture, width: number, height: number, order: number): THREE.Mesh {
  const clone = texture.clone();
  clone.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: clone,
      transparent: true,
      alphaTest: 0.05,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  mesh.renderOrder = order;
  return mesh;
}

function disc(radius: number, color: number, opacity: number, order: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), material(color, opacity, order));
  mesh.renderOrder = order;
  return mesh;
}

function ring(inner: number, outer: number, color: number, opacity: number, order: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), material(color, opacity, order));
  mesh.renderOrder = order;
  return mesh;
}

function material(color: number, opacity: number, _order: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function textLabel(text: string, color: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('World marker label canvas is unavailable.');
  context.font = '900 24px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 7;
  context.strokeStyle = '#050708';
  context.strokeText(text, 256, 32);
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.fillText(text, 256, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 23),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  mesh.renderOrder = 21;
  return mesh;
}

function removeAbsent<T extends THREE.Object3D>(map: Map<string, T>, present: Set<string>): void {
  for (const [id, object] of map) {
    if (present.has(id)) continue;
    disposeObject(object);
    map.delete(id);
  }
}

function removeAbsentExplosions(
  map: Map<string, TimedExplosion>,
  present: Set<string>
): void {
  for (const [id, explosion] of map) {
    if (present.has(id)) continue;
    disposeObject(explosion.group);
    map.delete(id);
  }
}

function disposeObject(object: THREE.Object3D): void {
  object.removeFromParent();
  object.traverse((child) => {
    if (child instanceof THREE.PointLight) {
      child.dispose();
      return;
    }
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const entry of materials) {
      if (entry instanceof THREE.MeshBasicMaterial) entry.map?.dispose();
      entry.dispose();
    }
  });
}

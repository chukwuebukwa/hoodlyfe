import * as THREE from 'three';
import {projectMissionWorld} from '../missions/mission-presentation-policy.ts';
import {projectileStyle} from '../rendering/projectile-render-policy.ts';
import {signalLampPresentation} from '../rendering/traffic-signal-render-policy.ts';
import {thrownProjectilePresentation} from '../rendering/thrown-projectile-render-policy.ts';
import type {
  DistrictNetworkState,
  NetworkExplosion,
  NetworkStreetService,
  NetworkTrafficSignal,
  NetworkWeaponPickup
} from '../types.ts';
import {serverAngleToThree, serverYToThree} from './three-prototype-policy.ts';

interface TimedExplosion {
  group: THREE.Group;
  startedAt: number;
  radius: number;
}

export class ThreeDistrictWorld {
  private readonly markers = new Map<string, THREE.Group>();
  private readonly bullets = new Map<string, THREE.Mesh>();
  private readonly grenades = new Map<string, THREE.Group>();
  private readonly explosions = new Map<string, TimedExplosion>();
  private readonly signals = new Map<string, THREE.Group>();
  private readonly grenadeTexture: THREE.Texture;

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly localPlayerId: string,
    private readonly surfaceHeightAt: (x: number, y: number) => number,
    grenadeTexture: THREE.Texture
  ) {
    this.grenadeTexture = grenadeTexture;
  }

  static async create(
    scene: THREE.Scene,
    localPlayerId: string,
    surfaceHeightAt: (x: number, y: number) => number
  ): Promise<ThreeDistrictWorld> {
    const grenade = await new THREE.TextureLoader().loadAsync('/assets/original/weapons/grenade.svg');
    grenade.colorSpace = THREE.SRGBColorSpace;
    grenade.magFilter = THREE.NearestFilter;
    grenade.minFilter = THREE.NearestFilter;
    return new ThreeDistrictWorld(scene, localPlayerId, surfaceHeightAt, grenade);
  }

  synchronize(state: DistrictNetworkState, nowMs: number, localSpaceId = 'street'): void {
    if (localSpaceId !== 'street') {
      this.clearStreetPresentation();
      return;
    }
    this.synchronizeMarkers(state, nowMs);
    this.synchronizeBullets(state);
    this.synchronizeGrenades(state, nowMs);
    this.synchronizeExplosions(state, nowMs);
    this.synchronizeSignals(state);
  }

  private clearStreetPresentation(): void {
    for (const group of this.markers.values()) disposeObject(group);
    for (const mesh of this.bullets.values()) disposeObject(mesh);
    for (const group of this.grenades.values()) disposeObject(group);
    for (const explosion of this.explosions.values()) disposeObject(explosion.group);
    for (const group of this.signals.values()) disposeObject(group);
    this.markers.clear();
    this.bullets.clear();
    this.grenades.clear();
    this.explosions.clear();
    this.signals.clear();
  }

  destroy(): void {
    for (const group of this.markers.values()) disposeObject(group);
    for (const mesh of this.bullets.values()) disposeObject(mesh);
    for (const group of this.grenades.values()) disposeObject(group);
    for (const explosion of this.explosions.values()) disposeObject(explosion.group);
    for (const group of this.signals.values()) disposeObject(group);
    this.markers.clear();
    this.bullets.clear();
    this.grenades.clear();
    this.explosions.clear();
    this.signals.clear();
    this.grenadeTexture.dispose();
  }

  private synchronizeMarkers(state: DistrictNetworkState, nowMs: number): void {
    const present = new Set<string>();
    for (const service of state.services?.values() ?? []) {
      const id = `service:${service.id}`;
      present.add(id);
      let group = this.markers.get(id);
      if (!group) {
        group = serviceMarker(service);
        this.addMarker(id, group);
      }
      positionAtSurface(group, service.x, service.y, this.surfaceHeightAt(service.x, service.y) + 7);
      pulseMarker(group, nowMs, service.id.length);
    }
    for (const pickup of state.weaponPickups?.values() ?? []) {
      if (!pickup.available) continue;
      const id = `pickup:${pickup.id}`;
      present.add(id);
      let group = this.markers.get(id);
      if (!group) {
        group = pickupMarker(pickup, this.grenadeTexture);
        this.addMarker(id, group);
      }
      positionAtSurface(group, pickup.x, pickup.y, this.surfaceHeightAt(pickup.x, pickup.y) + 8);
      pulseMarker(group, nowMs, pickup.id.length);
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
    positionAtSurface(group, x, y, this.surfaceHeightAt(x, y) + 7);
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
        this.surfaceHeightAt(bullet.x, bullet.y) + 12
      );
    }
    removeAbsent(this.bullets, present);
  }

  private synchronizeGrenades(state: DistrictNetworkState, nowMs: number): void {
    const present = new Set<string>();
    for (const [id, grenade] of state.thrownProjectiles ?? []) {
      present.add(id);
      let group = this.grenades.get(id);
      if (!group) {
        const shadow = disc(8, 0x050708, 0.42, 22);
        shadow.userData.role = 'shadow';
        const icon = texturedPlane(this.grenadeTexture, 16, 16, 24);
        icon.userData.role = 'icon';
        group = new THREE.Group();
        group.add(shadow, icon);
        this.grenades.set(id, group);
        this.scene.add(group);
      }
      const ground = this.surfaceHeightAt(grenade.x, grenade.y) + 8;
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
    const group = new THREE.Group();
    group.add(
      disc(radius * 0.38, 0xff6b2d, 0.82, 28),
      disc(radius * 0.18, 0xfff2a6, 1, 29),
      ring(radius * 0.24, radius * 0.33, 0xffd167, 0.9, 27)
    );
    positionAtSurface(
      group,
      explosion.x,
      explosion.y,
      this.surfaceHeightAt(explosion.x, explosion.y) + 15
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
      positionAtSurface(group, signal.x, signal.y, this.surfaceHeightAt(signal.x, signal.y) + 11);
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
  const group = ringMarker(20, 0xffd75a, `GRENADES x${pickup.quantity}`);
  const icon = texturedPlane(texture, 17, 17, 24);
  icon.position.z = 2;
  group.add(icon);
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
    if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) continue;
    const role = child.userData.role as 'red' | 'yellow' | 'green' | undefined;
    if (role) child.material.opacity = lamps[role].alpha;
  }
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
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const entry of materials) {
      if (entry instanceof THREE.MeshBasicMaterial) entry.map?.dispose();
      entry.dispose();
    }
  });
}

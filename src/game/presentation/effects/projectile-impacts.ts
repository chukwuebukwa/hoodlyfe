import * as THREE from 'three';
import type {ProjectileImpactPayload} from '../../../../shared/protocol/projectile-impacts.ts';
import {serverYToScene} from '../scene-policy.ts';

const MAX_IMPACTS = 64;
const MAX_PARTICLES_PER_IMPACT = 8;
const SPARK_PARTICLES_PER_IMPACT = 3;
const BLOOD_PARTICLES_PER_IMPACT = 6;
const SPARK_DURATION_MS = 140;
const BLOOD_DURATION_MS = 360;
const MAX_BLOOD_SPLATTERS = 48;
const BLOOD_SPLATTER_DURATION_MS = 18_000;
const BLOOD_SPLATTER_FADE_MS = 4_000;

interface ActiveImpact {
  id: string;
  startedAt: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  blood: boolean;
  particleCount: number;
  seed: number;
}

interface ActiveBloodSplatter {
  id: string;
  startedAt: number;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

export class ProjectileImpactEffects {
  private readonly scene: THREE.Scene;
  private readonly positions = new Float32Array(MAX_IMPACTS * MAX_PARTICLES_PER_IMPACT * 3);
  private readonly colors = new Float32Array(MAX_IMPACTS * MAX_PARTICLES_PER_IMPACT * 3);
  private readonly slots: Array<ActiveImpact | undefined> = Array(MAX_IMPACTS);
  private readonly bloodSplatters: ActiveBloodSplatter[] = [];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.PointsMaterial({
    size: 8,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true
  });
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;

  constructor(
    scene: THREE.Scene,
    private readonly surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number,
    private readonly bloodTexture?: THREE.Texture
  ) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'projectile-impact-particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 31;
    scene.add(this.points);
    this.scene = scene;
  }

  present(impacts: readonly ProjectileImpactPayload[], nowMs: number): void {
    for (const impact of impacts) {
      if (this.slots.some((slot) => slot?.id === impact.id)) continue;
      let index = this.slots.findIndex((slot) => !slot);
      if (index < 0) {
        index = this.oldestSlot();
        this.clearSlot(index);
      }
      const blood = impact.targetKind === 'player' || impact.targetKind === 'npc';
      const seed = hashString(impact.id);
      this.slots[index] = {
        id: impact.id,
        startedAt: nowMs,
        x: impact.x,
        y: impact.y,
        z: this.surfaceHeightAt(impact.x, impact.y, impact.surfaceId) + (blood ? 18 : 7),
        angle: impact.angle,
        blood,
        particleCount: blood
          ? impact.weapon === 'shotgun' ? MAX_PARTICLES_PER_IMPACT : BLOOD_PARTICLES_PER_IMPACT
          : SPARK_PARTICLES_PER_IMPACT,
        seed
      };
      if (blood) this.createBloodSplatter(impact, nowMs, seed);
    }
  }

  update(nowMs: number): void {
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex++) {
      const impact = this.slots[slotIndex];
      if (!impact) continue;
      const duration = impact.blood ? BLOOD_DURATION_MS : SPARK_DURATION_MS;
      const progress = (nowMs - impact.startedAt) / duration;
      if (progress >= 1) {
        this.slots[slotIndex] = undefined;
        this.clearSlot(slotIndex);
        continue;
      }
      const fade = (1 - Math.max(0, progress)) ** 2;
      this.clearSlot(slotIndex);
      for (let particle = 0; particle < impact.particleCount; particle++) {
        const offset = (slotIndex * MAX_PARTICLES_PER_IMPACT + particle) * 3;
        const spread = impact.blood
          ? seededUnit(impact.seed, particle) * 1.05 - 0.525
          : (particle - 1) * 0.72;
        const angle = impact.angle + (impact.blood ? spread : Math.PI + spread);
        const distanceScale = impact.blood
          ? 18 + seededUnit(impact.seed + 17, particle) * 24
          : 10 + particle * 4;
        const distance = progress * distanceScale;
        this.positions[offset] = impact.x + Math.cos(angle) * distance;
        this.positions[offset + 1] = serverYToScene(impact.y + Math.sin(angle) * distance);
        this.positions[offset + 2] = impact.blood
          ? impact.z + progress * (10 + particle * 1.4) - progress * progress * 19
          : impact.z + progress * (5 + particle * 3);
        this.colors[offset] = fade * (impact.blood ? 0.72 : 1);
        this.colors[offset + 1] = fade * (impact.blood ? 0.025 : 0.58);
        this.colors[offset + 2] = fade * (impact.blood ? 0.015 : 0.12);
      }
    }
    this.updateBloodSplatters(nowMs);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.colors.fill(0);
    for (const splatter of this.bloodSplatters.splice(0)) this.removeBloodSplatter(splatter);
    this.geometry.attributes.color.needsUpdate = true;
  }

  destroy(): void {
    this.clear();
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  private oldestSlot(): number {
    let oldest = 0;
    for (let index = 1; index < this.slots.length; index++) {
      if ((this.slots[index]?.startedAt ?? Infinity) < (this.slots[oldest]?.startedAt ?? Infinity)) {
        oldest = index;
      }
    }
    return oldest;
  }

  private clearSlot(slotIndex: number): void {
    const start = slotIndex * MAX_PARTICLES_PER_IMPACT * 3;
    this.colors.fill(0, start, start + MAX_PARTICLES_PER_IMPACT * 3);
  }

  private createBloodSplatter(
    impact: ProjectileImpactPayload,
    nowMs: number,
    seed: number
  ): void {
    if (!this.bloodTexture) return;
    while (this.bloodSplatters.length >= MAX_BLOOD_SPLATTERS) {
      this.removeBloodSplatter(this.bloodSplatters.shift()!);
    }
    const frame = seed % 4;
    const size = 22 + seed % 13;
    const geometry = bloodSplatterGeometry(size, frame);
    const material = new THREE.MeshBasicMaterial({
      map: this.bloodTexture,
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    const offset = 5 + seededUnit(seed, 31) * 10;
    mesh.name = 'projectile-blood-splatter';
    mesh.position.set(
      impact.x + Math.cos(impact.angle) * offset,
      serverYToScene(impact.y + Math.sin(impact.angle) * offset),
      this.surfaceHeightAt(impact.x, impact.y, impact.surfaceId) + 1.5
    );
    mesh.rotation.z = seededUnit(seed, 47) * Math.PI * 2;
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    this.bloodSplatters.push({id: impact.id, startedAt: nowMs, mesh});
  }

  private updateBloodSplatters(nowMs: number): void {
    for (let index = this.bloodSplatters.length - 1; index >= 0; index--) {
      const splatter = this.bloodSplatters[index];
      const age = nowMs - splatter.startedAt;
      if (age >= BLOOD_SPLATTER_DURATION_MS) {
        this.bloodSplatters.splice(index, 1);
        this.removeBloodSplatter(splatter);
        continue;
      }
      const fadeStartedAt = BLOOD_SPLATTER_DURATION_MS - BLOOD_SPLATTER_FADE_MS;
      splatter.mesh.material.opacity = age <= fadeStartedAt
        ? 0.88
        : 0.88 * (1 - (age - fadeStartedAt) / BLOOD_SPLATTER_FADE_MS);
    }
  }

  private removeBloodSplatter(splatter: ActiveBloodSplatter): void {
    splatter.mesh.removeFromParent();
    splatter.mesh.geometry.dispose();
    splatter.mesh.material.dispose();
  }
}

function bloodSplatterGeometry(size: number, frame: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(size, size);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const frameOffset = frame / 4;
  for (let index = 0; index < uv.count; index++) {
    uv.setX(index, frameOffset + uv.getX(index) / 4);
  }
  uv.needsUpdate = true;
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

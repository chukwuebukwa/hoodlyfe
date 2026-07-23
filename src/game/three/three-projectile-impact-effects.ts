import * as THREE from 'three';
import type {ProjectileImpactPayload} from '../../../shared/protocol/projectile-impacts.ts';
import {serverYToThree} from './three-prototype-policy.ts';

const MAX_IMPACTS = 64;
const PARTICLES_PER_IMPACT = 3;
const DURATION_MS = 140;

interface ActiveImpact {
  id: string;
  startedAt: number;
  x: number;
  y: number;
  z: number;
  angle: number;
}

export class ThreeProjectileImpactEffects {
  private readonly positions = new Float32Array(MAX_IMPACTS * PARTICLES_PER_IMPACT * 3);
  private readonly colors = new Float32Array(MAX_IMPACTS * PARTICLES_PER_IMPACT * 3);
  private readonly slots: Array<ActiveImpact | undefined> = Array(MAX_IMPACTS);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.PointsMaterial({
    size: 9,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;

  constructor(
    scene: THREE.Scene,
    private readonly surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number
  ) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 31;
    scene.add(this.points);
  }

  present(impacts: readonly ProjectileImpactPayload[], nowMs: number): void {
    for (const impact of impacts) {
      if (this.slots.some((slot) => slot?.id === impact.id)) continue;
      let index = this.slots.findIndex((slot) => !slot);
      if (index < 0) index = this.oldestSlot();
      this.slots[index] = {
        id: impact.id,
        startedAt: nowMs,
        x: impact.x,
        y: impact.y,
        z: this.surfaceHeightAt(impact.x, impact.y, impact.surfaceId) + 7,
        angle: impact.angle
      };
    }
  }

  update(nowMs: number): void {
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex++) {
      const impact = this.slots[slotIndex];
      if (!impact) continue;
      const progress = (nowMs - impact.startedAt) / DURATION_MS;
      if (progress >= 1) {
        this.slots[slotIndex] = undefined;
        this.clearSlot(slotIndex);
        continue;
      }
      const fade = (1 - Math.max(0, progress)) ** 2;
      for (let particle = 0; particle < PARTICLES_PER_IMPACT; particle++) {
        const offset = (slotIndex * PARTICLES_PER_IMPACT + particle) * 3;
        const angle = impact.angle + Math.PI + (particle - 1) * 0.72;
        const distance = progress * (10 + particle * 4);
        this.positions[offset] = impact.x + Math.cos(angle) * distance;
        this.positions[offset + 1] = serverYToThree(impact.y + Math.sin(angle) * distance);
        this.positions[offset + 2] = impact.z + progress * (5 + particle * 3);
        this.colors[offset] = fade;
        this.colors[offset + 1] = fade * 0.58;
        this.colors[offset + 2] = fade * 0.12;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.colors.fill(0);
    this.geometry.attributes.color.needsUpdate = true;
  }

  destroy(): void {
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
    const start = slotIndex * PARTICLES_PER_IMPACT * 3;
    this.colors.fill(0, start, start + PARTICLES_PER_IMPACT * 3);
  }
}

import * as THREE from 'three';
import {streetPropDefinition} from '../../../../shared/content/street-props.ts';
import type {NetworkStreetProp} from '../../types.ts';
import {serverAngleToScene, serverYToScene} from '../scene-policy.ts';

const WATER_FRAME_BOUNDS = [
  {minX: 23, minY: 43, maxX: 72, maxY: 53},
  {minX: 21, minY: 33, maxX: 75, maxY: 63},
  {minX: 24, minY: 31, maxX: 73, maxY: 64},
  {minX: 18, minY: 25, maxX: 78, maxY: 71},
  {minX: 24, minY: 32, maxX: 72, maxY: 64},
  {minX: 21, minY: 42, maxX: 75, maxY: 54}
] as const;
const WATER_CELL_SIZE = 96;
const WATER_WORLD_SIZE = 72;
const DEBRIS_LIFETIME_MS = 2_800;
const DEBRIS_FADE_MS = 700;
const MAX_DEBRIS = 72;

interface WaterSpray {
  group: THREE.Group;
  sprites: Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>;
}

interface ActiveDebris {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  startedAt: number;
  lastUpdatedAt: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  groundZ: number;
}

export class StreetPropEffects {
  private readonly waterSprays = new Map<string, WaterSpray>();
  private readonly previousDestroyed = new Map<string, boolean>();
  private readonly previousHitSequence = new Map<string, number>();
  private readonly debris: ActiveDebris[] = [];
  private readonly waterGeometry = new THREE.PlaneGeometry(WATER_WORLD_SIZE, WATER_WORLD_SIZE);
  private readonly waterMaterial: THREE.MeshBasicMaterial;
  private readonly debrisMaterial: THREE.MeshBasicMaterial;
  private waterFrame = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number,
    waterTexture: THREE.Texture,
    debrisTexture: THREE.Texture
  ) {
    this.waterMaterial = new THREE.MeshBasicMaterial({
      map: waterTexture,
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.debrisMaterial = new THREE.MeshBasicMaterial({
      map: debrisTexture,
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }

  synchronize(props: Iterable<[string, NetworkStreetProp]>, nowMs: number): void {
    const present = new Set<string>();
    this.updateWaterFrame(nowMs);
    for (const [id, prop] of props) {
      present.add(id);
      const definition = streetPropDefinition(prop.definitionId);
      const effect = definition?.effect;
      const wasDestroyed = this.previousDestroyed.get(id) ?? prop.destroyed;
      const previousHitSequence = this.previousHitSequence.get(id) ?? prop.hitSequence;

      if (effect?.kind === 'water-spray') {
        if (prop.destroyed) this.presentWater(id, prop, effect.anchor);
        else this.removeWater(id);
      }
      if (
        effect?.kind === 'trash-burst' &&
        prop.destroyed &&
        (!wasDestroyed || prop.hitSequence !== previousHitSequence)
      ) {
        this.spawnTrash(prop, nowMs, effect.pieceCount, effect.atlasColumns, effect.atlasRows);
      }
      this.previousDestroyed.set(id, prop.destroyed);
      this.previousHitSequence.set(id, prop.hitSequence);
    }
    for (const id of this.waterSprays.keys()) {
      if (!present.has(id)) this.removeWater(id);
    }
    for (const id of this.previousDestroyed.keys()) {
      if (present.has(id)) continue;
      this.previousDestroyed.delete(id);
      this.previousHitSequence.delete(id);
    }
    this.updateDebris(nowMs);
  }

  clear(): void {
    for (const spray of this.waterSprays.values()) spray.group.removeFromParent();
    this.waterSprays.clear();
    this.previousDestroyed.clear();
    this.previousHitSequence.clear();
    for (const item of this.debris.splice(0)) this.removeDebris(item);
  }

  destroy(): void {
    this.clear();
    this.waterGeometry.dispose();
    this.waterMaterial.map?.dispose();
    this.waterMaterial.dispose();
    this.debrisMaterial.map?.dispose();
    this.debrisMaterial.dispose();
  }

  private presentWater(
    id: string,
    prop: NetworkStreetProp,
    anchor: {x: number; y: number}
  ): void {
    let spray = this.waterSprays.get(id);
    if (!spray) {
      const group = new THREE.Group();
      const rightJet = this.createWaterJet(anchor.x, anchor.y, 0);
      const leftJet = this.createWaterJet(-anchor.x, anchor.y, Math.PI);
      group.add(rightJet.group, leftJet.group);
      this.scene.add(group);
      spray = {group, sprites: [rightJet.sprite, leftJet.sprite]};
      this.waterSprays.set(id, spray);
    }
    const sceneAngle = serverAngleToScene(prop.angle);
    spray.group.position.set(
      prop.x,
      serverYToScene(prop.y),
      this.surfaceHeightAt(prop.x, prop.y, prop.surfaceId) + 12
    );
    spray.group.rotation.z = sceneAngle;
    for (const sprite of spray.sprites) this.alignWaterOrigin(sprite, this.waterFrame);
  }

  private updateWaterFrame(nowMs: number): void {
    const frame = Math.floor(nowMs / 95) % WATER_FRAME_BOUNDS.length;
    if (frame === this.waterFrame) return;
    this.waterFrame = frame;
    setGridUvs(this.waterGeometry, frame, 2, 3);
    for (const spray of this.waterSprays.values()) {
      for (const sprite of spray.sprites) this.alignWaterOrigin(sprite, frame);
    }
  }

  private createWaterJet(
    x: number,
    y: number,
    rotation: number
  ): {
    group: THREE.Group;
    sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  } {
    const sprite = new THREE.Mesh(this.waterGeometry, this.waterMaterial);
    sprite.name = 'street-prop-water-spray';
    sprite.renderOrder = 21;
    this.alignWaterOrigin(sprite, Math.max(0, this.waterFrame));
    const group = new THREE.Group();
    group.position.set(x, y, 0);
    group.rotation.z = rotation;
    group.add(sprite);
    return {group, sprite};
  }

  private alignWaterOrigin(
    sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    frame: number
  ): void {
    const bounds = WATER_FRAME_BOUNDS[Math.max(0, frame)] ?? WATER_FRAME_BOUNDS[0];
    const centerY = (bounds.minY + bounds.maxY) / 2;
    sprite.position.set(
      (0.5 - bounds.minX / WATER_CELL_SIZE) * WATER_WORLD_SIZE,
      (centerY / WATER_CELL_SIZE - 0.5) * WATER_WORLD_SIZE,
      0
    );
  }

  private removeWater(id: string): void {
    const spray = this.waterSprays.get(id);
    if (!spray) return;
    spray.group.removeFromParent();
    this.waterSprays.delete(id);
  }

  private spawnTrash(
    prop: NetworkStreetProp,
    nowMs: number,
    count: number,
    columns: number,
    rows: number
  ): void {
    while (this.debris.length + count > MAX_DEBRIS) {
      const oldest = this.debris.shift();
      if (oldest) this.removeDebris(oldest);
    }
    const seed = hashString(`${prop.id}:${prop.hitSequence}`);
    const baseZ = this.surfaceHeightAt(prop.x, prop.y, prop.surfaceId) + 2;
    const sceneHitAngle = serverAngleToScene(prop.hitAngle);
    for (let index = 0; index < count; index++) {
      const frame = (seed + index * 5) % (columns * rows);
      const size = 10 + seededUnit(seed, index * 7 + 1) * 8;
      const geometry = new THREE.PlaneGeometry(size, size);
      setGridUvs(geometry, frame, columns, rows);
      const mesh = new THREE.Mesh(geometry, this.debrisMaterial);
      mesh.name = 'street-prop-trash-debris';
      mesh.renderOrder = 20;
      mesh.position.set(prop.x, serverYToScene(prop.y), baseZ + 8);
      mesh.rotation.z = seededUnit(seed, index * 7 + 2) * Math.PI * 2;
      this.scene.add(mesh);
      const spread = (seededUnit(seed, index * 7 + 3) - 0.5) * 0.9;
      const angle = sceneHitAngle + spread;
      const speed = 34 + seededUnit(seed, index * 7 + 4) * 24;
      this.debris.push({
        mesh,
        startedAt: nowMs,
        lastUpdatedAt: nowMs,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 28 + seededUnit(seed, index * 7 + 5) * 20,
        spin: (seededUnit(seed, index * 7 + 6) - 0.5) * 11,
        groundZ: baseZ
      });
    }
  }

  private updateDebris(nowMs: number): void {
    for (let index = this.debris.length - 1; index >= 0; index--) {
      const item = this.debris[index];
      const age = nowMs - item.startedAt;
      if (age >= DEBRIS_LIFETIME_MS) {
        this.debris.splice(index, 1);
        this.removeDebris(item);
        continue;
      }
      const dt = Math.min(0.05, Math.max(0, nowMs - item.lastUpdatedAt) / 1_000);
      item.lastUpdatedAt = nowMs;
      item.vz -= 120 * dt;
      item.mesh.position.x += item.vx * dt;
      item.mesh.position.y += item.vy * dt;
      item.mesh.position.z += item.vz * dt;
      item.mesh.rotation.z += item.spin * dt;
      if (item.mesh.position.z <= item.groundZ) {
        item.mesh.position.z = item.groundZ;
        if (Math.abs(item.vz) > 7) {
          item.vz = -item.vz * 0.34;
          item.vx *= 0.5;
          item.vy *= 0.5;
          item.spin *= 0.58;
        } else {
          item.vz = 0;
          item.vx = 0;
          item.vy = 0;
          item.spin = 0;
        }
      }
      const fadeStart = DEBRIS_LIFETIME_MS - DEBRIS_FADE_MS;
      item.mesh.scale.setScalar(age <= fadeStart ? 1 : 1 - (age - fadeStart) / DEBRIS_FADE_MS);
    }
  }

  private removeDebris(item: ActiveDebris): void {
    item.mesh.removeFromParent();
    item.mesh.geometry.dispose();
  }
}

function setGridUvs(
  geometry: THREE.PlaneGeometry,
  frame: number,
  columns: number,
  rows: number
): void {
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const userData = geometry.userData as {baseGridUvs?: Float32Array};
  const baseUvs = userData.baseGridUvs ?? new Float32Array(uv.array as ArrayLike<number>);
  userData.baseGridUvs = baseUvs;
  for (let index = 0; index < uv.count; index++) {
    uv.setXY(
      index,
      (column + baseUvs[index * 2]) / columns,
      1 - (row + 1 - baseUvs[index * 2 + 1]) / rows
    );
  }
  uv.needsUpdate = true;
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

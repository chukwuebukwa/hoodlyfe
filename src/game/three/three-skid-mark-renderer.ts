import * as THREE from 'three';
import type {VehicleKind} from '../../../shared/content/vehicle-catalog.ts';
import {
  vehicleSkidMarkPresentation,
  type VehicleSkidMarkPresentation
} from '../rendering/vehicle-skid-mark-policy.ts';
import {serverYToThree} from './three-prototype-policy.ts';

interface SkidVehicleSample {
  x: number;
  y: number;
  angle: number;
  linvelX: number;
  linvelY: number;
  kind: VehicleKind;
  surfaceId: string;
  destroyed?: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
}

interface VehicleTrail {
  left?: TrailPoint;
  right?: TrailPoint;
  surfaceId: string;
}

interface SkidMark {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  createdAt: number;
  opacity: number;
}

const MAXIMUM_MARKS = 384;
const MINIMUM_SEGMENT_LENGTH = 8;
const MAXIMUM_SEGMENT_LENGTH = 72;
const MARK_WIDTH = 3.2;
const FULL_OPACITY_MS = 8_000;
const MARK_LIFETIME_MS = 16_000;

export class ThreeSkidMarkRenderer {
  private readonly group = new THREE.Group();
  private readonly trails = new Map<string, VehicleTrail>();
  private readonly touched = new Set<string>();
  private readonly marks: SkidMark[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number
  ) {
    this.group.name = 'vehicle-skid-marks';
    scene.add(this.group);
  }

  beginFrame(visible: boolean): void {
    this.group.visible = visible;
    this.touched.clear();
  }

  observe(vehicleId: string, sample: SkidVehicleSample, nowMs: number): void {
    this.touched.add(vehicleId);
    const presentation = vehicleSkidMarkPresentation(sample);
    let trail = this.trails.get(vehicleId);
    if (!trail) {
      trail = {surfaceId: sample.surfaceId};
      this.trails.set(vehicleId, trail);
    }
    if (!presentation.active || trail.surfaceId !== sample.surfaceId) {
      trail.left = undefined;
      trail.right = undefined;
      trail.surfaceId = sample.surfaceId;
      if (!presentation.active) return;
    }
    if (!trail.left || !trail.right) {
      trail.left = presentation.rearLeft;
      trail.right = presentation.rearRight;
      return;
    }
    const leftDistance = distance(trail.left, presentation.rearLeft);
    const rightDistance = distance(trail.right, presentation.rearRight);
    const segmentLength = Math.max(leftDistance, rightDistance);
    if (segmentLength > MAXIMUM_SEGMENT_LENGTH) {
      trail.left = presentation.rearLeft;
      trail.right = presentation.rearRight;
      return;
    }
    if (segmentLength < MINIMUM_SEGMENT_LENGTH) return;
    this.addMark(trail.left, presentation.rearLeft, trail.right, presentation.rearRight, {
      presentation,
      surfaceId: sample.surfaceId,
      nowMs
    });
    trail.left = presentation.rearLeft;
    trail.right = presentation.rearRight;
  }

  endFrame(nowMs: number): void {
    for (const vehicleId of this.trails.keys()) {
      if (!this.touched.has(vehicleId)) this.trails.delete(vehicleId);
    }
    for (let index = this.marks.length - 1; index >= 0; index--) {
      const mark = this.marks[index];
      const age = nowMs - mark.createdAt;
      if (age >= MARK_LIFETIME_MS) {
        this.removeMark(index);
        continue;
      }
      const fade = age <= FULL_OPACITY_MS
        ? 1
        : 1 - (age - FULL_OPACITY_MS) / (MARK_LIFETIME_MS - FULL_OPACITY_MS);
      mark.mesh.material.opacity = mark.opacity * Math.max(0, fade);
    }
  }

  destroy(): void {
    while (this.marks.length > 0) this.removeMark(this.marks.length - 1);
    this.trails.clear();
    this.group.removeFromParent();
  }

  private addMark(
    leftFrom: TrailPoint,
    leftTo: TrailPoint,
    rightFrom: TrailPoint,
    rightTo: TrailPoint,
    options: {
      presentation: VehicleSkidMarkPresentation;
      surfaceId: string;
      nowMs: number;
    }
  ): void {
    const geometry = pairedStripGeometry(leftFrom, leftTo, rightFrom, rightTo, MARK_WIDTH);
    const opacity = 0.18 + options.presentation.intensity * 0.3;
    const material = new THREE.MeshBasicMaterial({
      color: 0x141616,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const mesh = new THREE.Mesh(geometry, material);
    const centerX = (leftFrom.x + leftTo.x + rightFrom.x + rightTo.x) / 4;
    const centerY = (leftFrom.y + leftTo.y + rightFrom.y + rightTo.y) / 4;
    mesh.position.z = this.surfaceHeightAt(centerX, centerY, options.surfaceId) + 1.25;
    mesh.renderOrder = 4;
    this.group.add(mesh);
    this.marks.push({mesh, createdAt: options.nowMs, opacity});
    while (this.marks.length > MAXIMUM_MARKS) this.removeMark(0);
  }

  private removeMark(index: number): void {
    const [mark] = this.marks.splice(index, 1);
    if (!mark) return;
    this.group.remove(mark.mesh);
    mark.mesh.geometry.dispose();
    mark.mesh.material.dispose();
  }
}

function pairedStripGeometry(
  leftFrom: TrailPoint,
  leftTo: TrailPoint,
  rightFrom: TrailPoint,
  rightTo: TrailPoint,
  width: number
): THREE.BufferGeometry {
  const positions = [
    ...stripVertices(leftFrom, leftTo, width),
    ...stripVertices(rightFrom, rightTo, width)
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeBoundingSphere();
  return geometry;
}

function stripVertices(from: TrailPoint, to: TrailPoint, width: number): number[] {
  const fromX = from.x;
  const fromY = serverYToThree(from.y);
  const toX = to.x;
  const toY = serverYToThree(to.y);
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const length = Math.max(0.001, Math.hypot(deltaX, deltaY));
  const sideX = -deltaY / length * width / 2;
  const sideY = deltaX / length * width / 2;
  return [
    fromX + sideX, fromY + sideY, 0,
    fromX - sideX, fromY - sideY, 0,
    toX - sideX, toY - sideY, 0,
    toX + sideX, toY + sideY, 0
  ];
}

function distance(left: TrailPoint, right: TrailPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

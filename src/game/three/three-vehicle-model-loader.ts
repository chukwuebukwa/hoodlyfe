import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import type {
  VehicleCollisionDefinition,
  VehicleKind
} from '../../../shared/content/vehicle-catalog.ts';

const VEHICLE_MODEL_URLS: Partial<Record<VehicleKind, string>> = Object.freeze({
  sedan: '/assets/vehicles/3d/sedan.fbx'
});

type ColorMaterial = THREE.Material & {
  color?: THREE.Color;
  opacity?: number;
  transparent?: boolean;
};

export class ThreeVehicleModelLoader {
  private readonly loader = new FBXLoader();
  private readonly sources = new Map<VehicleKind, Promise<THREE.Group | undefined>>();
  private destroyed = false;

  hasModel(kind: VehicleKind): boolean {
    return Boolean(VEHICLE_MODEL_URLS[kind]);
  }

  async createInstance(
    kind: VehicleKind,
    collision: VehicleCollisionDefinition
  ): Promise<THREE.Group | undefined> {
    const source = await this.source(kind, collision);
    if (!source || this.destroyed) return undefined;
    return cloneVehicleModel(source);
  }

  destroy(): void {
    this.destroyed = true;
    for (const pending of this.sources.values()) {
      void pending.then((source) => {
        if (source) disposeObjectResources(source, true);
      });
    }
    this.sources.clear();
  }

  private source(
    kind: VehicleKind,
    collision: VehicleCollisionDefinition
  ): Promise<THREE.Group | undefined> {
    const cached = this.sources.get(kind);
    if (cached) return cached;
    const url = VEHICLE_MODEL_URLS[kind];
    if (!url) return Promise.resolve(undefined);
    const pending = this.loader.loadAsync(url)
      .then((source) => normalizeVehicleModel(source, collision))
      .catch((error: unknown) => {
        console.warn(`[vehicles] failed to load ${kind} model`, error);
        return undefined;
      });
    this.sources.set(kind, pending);
    return pending;
  }
}

export function normalizeVehicleModel(
  source: THREE.Group,
  collision: VehicleCollisionDefinition
): THREE.Group {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (
    !Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z) ||
    size.x <= 0 || size.y <= 0 || size.z <= 0
  ) {
    throw new Error('Vehicle model has invalid bounds.');
  }

  // The source pack uses X=width, Y=up, Z=forward. Center it at tyre level,
  // scale it to the authoritative collider, then map those axes into our Z-up world.
  source.position.set(-center.x, -bounds.min.y, -center.z);
  const centered = new THREE.Group();
  centered.name = 'vehicle-model-centered';
  centered.add(source);
  const scaled = new THREE.Group();
  scaled.name = 'vehicle-model-scaled';
  scaled.scale.setScalar(Math.min(collision.width / size.x, collision.length / size.z));
  scaled.add(centered);

  const orientationMatrix = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0)
  );
  const orientation = new THREE.Group();
  orientation.name = 'vehicle-model-import-orientation';
  orientation.quaternion.setFromRotationMatrix(orientationMatrix);
  orientation.add(scaled);

  // Gameplay heading is applied to this identity root. Keeping it separate from
  // the FBX basis correction prevents yaw updates from tipping the car sideways.
  const root = new THREE.Group();
  root.name = 'vehicle-model';
  root.add(orientation);
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
  return root;
}

export function updateVehicleModelVisual(
  root: THREE.Object3D,
  opacity: number,
  tint?: number
): void {
  const tintColor = new THREE.Color(tint ?? 0xffffff);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of materialsOf(object)) {
      const baseColor = material.userData.vehicleBaseColor;
      if (material.color && typeof baseColor === 'number') {
        material.color.setHex(baseColor).multiply(tintColor);
      }
      const baseOpacity = Number(material.userData.vehicleBaseOpacity ?? 1);
      if (typeof material.opacity === 'number') material.opacity = baseOpacity * opacity;
      if (typeof material.transparent === 'boolean') {
        material.transparent = baseOpacity * opacity < 0.999;
      }
    }
  });
}

export function disposeVehicleModelInstance(root: THREE.Object3D): void {
  disposeObjectResources(root, false);
}

function cloneVehicleModel(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);
  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const clonedMaterials = materialsOf(object).map((material) => {
      const cloned = material.clone() as ColorMaterial;
      cloned.userData = {...material.userData};
      if (cloned.color) cloned.userData.vehicleBaseColor = cloned.color.getHex();
      if (typeof cloned.opacity === 'number') {
        cloned.userData.vehicleBaseOpacity = cloned.opacity;
      }
      return cloned;
    });
    object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
  });
  return clone;
}

function materialsOf(mesh: THREE.Mesh): ColorMaterial[] {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as ColorMaterial[];
}

function disposeObjectResources(root: THREE.Object3D, includeGeometry: boolean): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (includeGeometry) geometries.add(object.geometry);
    for (const material of materialsOf(object)) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

import * as THREE from 'three';
import {
  INTERIORS,
  STREET_SPACE_ID,
  containsPoint,
  interiorDefinition,
  type InteriorDefinition
} from '../../../shared/content/interior-catalog.ts';
import type {DistrictNetworkState} from '../types.ts';
import {serverYToThree} from './three-prototype-policy.ts';

export class ThreeInteriorRenderer {
  private readonly interiors = new Map<string, THREE.Group>();
  private readonly exteriorDoors = new Map<string, THREE.Group>();

  constructor(private readonly scene: THREE.Scene) {
    for (const definition of INTERIORS) {
      const interior = createInterior(definition);
      interior.visible = false;
      this.interiors.set(definition.id, interior);
      this.scene.add(interior);
      const door = createExteriorDoor(definition);
      this.exteriorDoors.set(definition.id, door);
      this.scene.add(door);
    }
  }

  synchronize(state: DistrictNetworkState, localPlayerId: string): string {
    const spaceId = state.players.get(localPlayerId)?.spaceId || STREET_SPACE_ID;
    for (const [id, group] of this.interiors) group.visible = id === spaceId;
    for (const group of this.exteriorDoors.values()) group.visible = spaceId === STREET_SPACE_ID;
    const label = document.querySelector('#district-label span');
    if (label) label.textContent = interiorDefinition(spaceId)?.label ?? 'Industrial District';
    return spaceId;
  }

  surfaceHeightAt(x: number, y: number): number | undefined {
    for (const definition of INTERIORS) {
      if (containsPoint(definition.bounds, x, y)) return definition.floorZ;
    }
    return undefined;
  }

  destroy(): void {
    for (const group of [...this.interiors.values(), ...this.exteriorDoors.values()]) {
      disposeGroup(group);
    }
    this.interiors.clear();
    this.exteriorDoors.clear();
  }
}

function createInterior(definition: InteriorDefinition): THREE.Group {
  const group = new THREE.Group();
  const {bounds, floorZ} = definition;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = serverYToThree((bounds.minY + bounds.maxY) / 2);

  group.add(box(width, height, 8, 0x2a2d2f, centerX, centerY, floorZ - 4));
  group.add(box(width - 28, height - 28, 2, 0x633047, centerX, centerY, floorZ + 1));

  const wallColor = 0x202427;
  const wallHeight = 56;
  group.add(box(width, 16, wallHeight, wallColor, centerX, serverYToThree(bounds.minY + 8), floorZ + wallHeight / 2));
  group.add(box(width, 16, wallHeight, wallColor, centerX, serverYToThree(bounds.maxY - 8), floorZ + wallHeight / 2));
  group.add(box(16, height, wallHeight, wallColor, bounds.minX + 8, centerY, floorZ + wallHeight / 2));
  const eastWallX = bounds.maxX - 8;
  group.add(box(16, 156, wallHeight, wallColor, eastWallX, serverYToThree(bounds.minY + 78), floorZ + wallHeight / 2));
  group.add(box(16, 156, wallHeight, wallColor, eastWallX, serverYToThree(bounds.maxY - 78), floorZ + wallHeight / 2));

  const leftRackX = bounds.minX + 78;
  const upperRackY = bounds.minY + 48;
  const lowerRackY = bounds.maxY - 48;
  const counterX = bounds.maxX - 98;
  group.add(box(80, 40, 22, 0x9a5f37, leftRackX, serverYToThree(upperRackY), floorZ + 11));
  group.add(box(80, 40, 22, 0x9a5f37, leftRackX, serverYToThree(lowerRackY), floorZ + 11));
  group.add(box(60, 110, 30, 0x171a1c, counterX, centerY, floorZ + 15));

  for (const [x, y, color] of [
    [leftRackX - 20, upperRackY, 0xf2c94c], [leftRackX + 20, upperRackY, 0x63df8a],
    [leftRackX - 20, lowerRackY, 0x55d6ff], [leftRackX + 20, lowerRackY, 0xff7fb6]
  ] as const) {
    group.add(box(24, 34, 8, color, x, serverYToThree(y), floorZ + 26));
  }

  const threshold = box(20, 68, 2, 0xf2c94c, bounds.maxX - 18, serverYToThree(2040), floorZ + 2);
  threshold.material.transparent = true;
  threshold.material.opacity = 0.75;
  group.add(threshold);
  return group;
}

function createExteriorDoor(definition: InteriorDefinition): THREE.Group {
  const group = new THREE.Group();
  const {x, y} = definition.exteriorDoor;
  const floorZ = 128;
  const wallX = x - 14;
  const shadow = box(10, 46, 38, 0x050708, wallX, serverYToThree(y), floorZ + 19);
  const threshold = box(7, 50, 3, 0xf2c94c, wallX + 7, serverYToThree(y), floorZ + 2);
  threshold.material.transparent = true;
  threshold.material.opacity = 0.8;
  group.add(shadow, threshold);
  return group;
}

function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  x: number,
  y: number,
  z: number
): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({color, side: THREE.DoubleSide})
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function disposeGroup(group: THREE.Group): void {
  group.removeFromParent();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

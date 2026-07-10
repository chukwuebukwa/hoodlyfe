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
  const hospital = definition.kind === 'hospital';

  group.add(box(width, height, 8, 0x2a2d2f, centerX, centerY, floorZ - 4));
  group.add(box(
    width - 28,
    height - 28,
    2,
    hospital ? 0xd8e4df : 0x633047,
    centerX,
    centerY,
    floorZ + 1
  ));

  const wallColor = 0x202427;
  const wallHeight = 56;
  group.add(box(width, 16, wallHeight, wallColor, centerX, serverYToThree(bounds.minY + 8), floorZ + wallHeight / 2));
  group.add(box(16, height, wallHeight, wallColor, bounds.minX + 8, centerY, floorZ + wallHeight / 2));
  if (definition.exteriorDoor.side === 'south') {
    group.add(box(16, height, wallHeight, wallColor, bounds.maxX - 8, centerY, floorZ + wallHeight / 2));
    addHorizontalDoorWall(group, definition, wallColor, wallHeight, floorZ);
  } else {
    addVerticalDoorWall(group, definition, wallColor, wallHeight, floorZ);
    group.add(box(width, 16, wallHeight, wallColor, centerX, serverYToThree(bounds.maxY - 8), floorZ + wallHeight / 2));
  }

  if (hospital) addHospitalFixtures(group, floorZ);
  else addClothingFixtures(group, definition, centerY, floorZ);

  const threshold = definition.exteriorDoor.side === 'south'
    ? box(68, 20, 2, 0xf2c94c, definition.entry.x, serverYToThree(bounds.maxY - 18), floorZ + 2)
    : box(20, 68, 2, 0xf2c94c, bounds.maxX - 18, serverYToThree(definition.entry.y), floorZ + 2);
  threshold.material.transparent = true;
  threshold.material.opacity = 0.75;
  group.add(threshold);
  return group;
}

function createExteriorDoor(definition: InteriorDefinition): THREE.Group {
  const group = new THREE.Group();
  const {x, y} = definition.exteriorDoor;
  const floorZ = definition.floorZ - 4;
  const hospital = definition.kind === 'hospital';
  const frameColor = hospital ? 0x46c981 : 0xd9a62e;
  const lintelColor = hospital ? 0x63df8a : 0xf2c94c;
  const isSouth = definition.exteriorDoor.side === 'south';
  const facadeY = y - 14;
  const facadeX = x - 14;
  const shadow = isSouth
    ? box(46, 7, 36, 0x050708, x, serverYToThree(facadeY), floorZ + 18)
    : box(7, 46, 36, 0x050708, facadeX, serverYToThree(y), floorZ + 18);
  const firstJamb = isSouth
    ? box(6, 9, 40, frameColor, x - 25, serverYToThree(facadeY + 1), floorZ + 20)
    : box(9, 6, 40, frameColor, facadeX - 1, serverYToThree(y - 25), floorZ + 20);
  const secondJamb = isSouth
    ? box(6, 9, 40, frameColor, x + 25, serverYToThree(facadeY + 1), floorZ + 20)
    : box(9, 6, 40, frameColor, facadeX - 1, serverYToThree(y + 25), floorZ + 20);
  const lintel = isSouth
    ? box(56, 9, 6, lintelColor, x, serverYToThree(facadeY + 1), floorZ + 39)
    : box(9, 56, 6, lintelColor, facadeX - 1, serverYToThree(y), floorZ + 39);
  const threshold = isSouth
    ? box(52, 16, 3, lintelColor, x, serverYToThree(y - 5), floorZ + 2)
    : box(16, 52, 3, lintelColor, x - 5, serverYToThree(y), floorZ + 2);
  threshold.material.transparent = true;
  threshold.material.opacity = 0.8;
  group.add(shadow, firstJamb, secondJamb, lintel, threshold);
  if (hospital) {
    const signboard = isSouth
      ? box(156, 24, 6, 0x153a33, x, serverYToThree(y - 9), floorZ + 43)
      : box(24, 156, 6, 0x153a33, x - 9, serverYToThree(y), floorZ + 43);
    const label = facadeLabel('MERCY HOSPITAL', 0x63df8a);
    label.position.set(x, serverYToThree(y - 9), floorZ + 47);
    group.add(signboard, label);
  }
  return group;
}

function addHospitalFixtures(group: THREE.Group, floorZ: number): void {
  for (const x of [2620, 2732]) {
    group.add(box(64, 40, 18, 0x4d6670, x, serverYToThree(1712), floorZ + 9));
    group.add(box(56, 32, 5, 0xf4f8f7, x, serverYToThree(1712), floorZ + 20));
    group.add(box(18, 28, 4, 0x8fd8ef, x - 17, serverYToThree(1712), floorZ + 25));
  }
  group.add(box(60, 32, 16, 0x5f747b, 2618, serverYToThree(1796), floorZ + 8));
  group.add(box(70, 44, 28, 0x256456, 2725, serverYToThree(1822), floorZ + 14));
  group.add(box(62, 36, 4, 0x63df8a, 2725, serverYToThree(1822), floorZ + 30));
  group.add(box(12, 44, 2, 0xe23d4f, 2676, serverYToThree(1756), floorZ + 3));
  group.add(box(44, 12, 2, 0xe23d4f, 2676, serverYToThree(1756), floorZ + 4));
}

function addClothingFixtures(
  group: THREE.Group,
  definition: InteriorDefinition,
  centerY: number,
  floorZ: number
): void {
  const {bounds} = definition;
  const leftRackX = bounds.minX + 78;
  const upperRackY = bounds.minY + 48;
  const lowerRackY = definition.exteriorDoor.side === 'south'
    ? bounds.minY + 112
    : bounds.maxY - 48;
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
}

function facadeLabel(text: string, color: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Interior facade label canvas is unavailable.');
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
    new THREE.PlaneGeometry(170, 22),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  mesh.renderOrder = 24;
  return mesh;
}

function addHorizontalDoorWall(
  group: THREE.Group,
  definition: InteriorDefinition,
  color: number,
  height: number,
  floorZ: number
): void {
  const {bounds, exitDoor} = definition;
  const leftWidth = exitDoor.minX - bounds.minX;
  const rightWidth = bounds.maxX - exitDoor.maxX;
  group.add(box(
    leftWidth,
    16,
    height,
    color,
    bounds.minX + leftWidth / 2,
    serverYToThree(bounds.maxY - 8),
    floorZ + height / 2
  ));
  group.add(box(
    rightWidth,
    16,
    height,
    color,
    exitDoor.maxX + rightWidth / 2,
    serverYToThree(bounds.maxY - 8),
    floorZ + height / 2
  ));
}

function addVerticalDoorWall(
  group: THREE.Group,
  definition: InteriorDefinition,
  color: number,
  height: number,
  floorZ: number
): void {
  const {bounds, exitDoor} = definition;
  const upperHeight = exitDoor.minY - bounds.minY;
  const lowerHeight = bounds.maxY - exitDoor.maxY;
  group.add(box(
    16,
    upperHeight,
    height,
    color,
    bounds.maxX - 8,
    serverYToThree(bounds.minY + upperHeight / 2),
    floorZ + height / 2
  ));
  group.add(box(
    16,
    lowerHeight,
    height,
    color,
    bounds.maxX - 8,
    serverYToThree(exitDoor.maxY + lowerHeight / 2),
    floorZ + height / 2
  ));
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
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
      material.dispose();
    }
  });
}

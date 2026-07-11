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
  const palette = interiorPalette(definition.kind);

  group.add(box(width, height, 8, 0x2a2d2f, centerX, centerY, floorZ - 4));
  group.add(box(
    width - 28,
    height - 28,
    2,
    palette.floor,
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

  if (definition.kind === 'hospital') addHospitalFixtures(group, definition, floorZ);
  else if (definition.kind === 'clothing') addClothingFixtures(group, definition, floorZ);
  else addAmmunitionFixtures(group, definition, floorZ);

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
  const palette = interiorPalette(definition.kind);
  const frameColor = palette.frame;
  const lintelColor = palette.accent;
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
  const signboard = isSouth
    ? box(176, 24, 6, palette.sign, x, serverYToThree(y - 9), floorZ + 43)
    : box(24, 176, 6, palette.sign, x - 9, serverYToThree(y), floorZ + 43);
  const label = facadeLabel(definition.label.toUpperCase(), palette.accent);
  label.position.set(x, serverYToThree(y - 9), floorZ + 47);
  group.add(signboard, label);
  return group;
}

function addHospitalFixtures(
  group: THREE.Group,
  definition: InteriorDefinition,
  floorZ: number
): void {
  const [firstBed, secondBed, bench, counter] = definition.obstacles;
  for (const obstacle of [firstBed, secondBed]) {
    if (!obstacle) continue;
    addObstacleBox(group, obstacle, 18, 0x4d6670, floorZ);
    addObstacleBox(group, inset(obstacle, 4), 5, 0xf4f8f7, floorZ + 18);
  }
  if (bench) addObstacleBox(group, bench, 16, 0x5f747b, floorZ);
  if (counter) {
    addObstacleBox(group, counter, 28, 0x256456, floorZ);
    addObstacleBox(group, inset(counter, 4), 4, 0x63df8a, floorZ + 28);
  }
  if (definition.recoveryAnchor) {
    const {x, y} = definition.recoveryAnchor;
    group.add(box(12, 44, 2, 0xe23d4f, x, serverYToThree(y), floorZ + 3));
    group.add(box(44, 12, 2, 0xe23d4f, x, serverYToThree(y), floorZ + 4));
  }
}

function addClothingFixtures(
  group: THREE.Group,
  definition: InteriorDefinition,
  floorZ: number
): void {
  const colors = [0xf2c94c, 0x63df8a, 0x55d6ff];
  definition.obstacles.forEach((obstacle, index) => {
    const isCounter = index === definition.obstacles.length - 1;
    addObstacleBox(group, obstacle, isCounter ? 30 : 22, isCounter ? 0x171a1c : 0x9a5f37, floorZ);
    if (!isCounter) addObstacleBox(group, inset(obstacle, 10), 8, colors[index % colors.length], floorZ + 22);
  });
}

function addAmmunitionFixtures(
  group: THREE.Group,
  definition: InteriorDefinition,
  floorZ: number
): void {
  definition.obstacles.forEach((obstacle, index) => {
    const isCounter = index === definition.obstacles.length - 1;
    addObstacleBox(group, obstacle, isCounter ? 28 : 34, isCounter ? 0x242a2d : 0x3c4549, floorZ);
    if (!isCounter) {
      const centerX = (obstacle.minX + obstacle.maxX) / 2;
      const centerY = (obstacle.minY + obstacle.maxY) / 2;
      for (const offset of [-22, 0, 22]) {
        group.add(box(24, 7, 7, 0xd8b24a, centerX, serverYToThree(centerY + offset), floorZ + 36));
      }
    }
  });
  const anchor = definition.serviceAnchors[0];
  if (anchor) {
    group.add(box(28, 18, 4, 0xf2c94c, anchor.x, serverYToThree(anchor.y), floorZ + 3));
  }
}

function addObstacleBox(
  group: THREE.Group,
  obstacle: {minX: number; minY: number; maxX: number; maxY: number},
  height: number,
  color: number,
  floorZ: number
): void {
  group.add(box(
    obstacle.maxX - obstacle.minX,
    obstacle.maxY - obstacle.minY,
    height,
    color,
    (obstacle.minX + obstacle.maxX) / 2,
    serverYToThree((obstacle.minY + obstacle.maxY) / 2),
    floorZ + height / 2
  ));
}

function inset(
  obstacle: {minX: number; minY: number; maxX: number; maxY: number},
  amount: number
) {
  return {
    minX: obstacle.minX + amount,
    minY: obstacle.minY + amount,
    maxX: obstacle.maxX - amount,
    maxY: obstacle.maxY - amount
  };
}

function interiorPalette(kind: InteriorDefinition['kind']) {
  if (kind === 'hospital') {
    return {floor: 0xd8e4df, frame: 0x46c981, accent: 0x63df8a, sign: 0x153a33};
  }
  if (kind === 'clothing') {
    return {floor: 0x633047, frame: 0xd9549b, accent: 0xff7fb6, sign: 0x3b1830};
  }
  return {floor: 0x44494b, frame: 0xc79e31, accent: 0xf2c94c, sign: 0x28230f};
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

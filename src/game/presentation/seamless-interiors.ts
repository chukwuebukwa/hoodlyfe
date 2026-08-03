import * as THREE from 'three';
import {
  SEAMLESS_INTERIORS,
  seamlessInteriorAt,
  type SeamlessInteriorDefinition,
  type SeamlessInteriorObstacle,
  type SeamlessGarageDoorDefinition,
  type WorldRect
} from '../../../shared/content/seamless-interior-catalog.ts';
import {garageDoorProgress} from '../../../shared/content/garage-door.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import type {DistrictNetworkState} from '../types.ts';
import {serverYToScene} from './scene-policy.ts';

export class SeamlessInteriorPresentation {
  private readonly structures = new Map<string, THREE.Group>();
  private readonly garageDoors = new Map<string, THREE.Group>();
  private activeInteriorId?: string;

  constructor(private readonly scene: THREE.Scene) {
    for (const definition of SEAMLESS_INTERIORS) this.create(definition);
  }

  synchronize(
    state: DistrictNetworkState,
    localPlayerId: string,
    serverTimeMs = state.serverTimeMs ?? 0
  ): string | undefined {
    const player = state.players.get(localPlayerId);
    const active = player?.spaceId === STREET_SPACE_ID
      ? seamlessInteriorAt(player.x, player.y, this.activeInteriorId)
      : undefined;
    this.activeInteriorId = active?.id;
    if (active) {
      const districtLabel = document.querySelector('#district-label span');
      if (districtLabel) districtLabel.textContent = active.label;
    }
    for (const definition of SEAMLESS_INTERIORS) {
      const door = definition.garageDoor;
      if (!door) continue;
      const mesh = this.garageDoors.get(door.id);
      const network = state.garageDoors?.get(door.id);
      if (!mesh || !network) continue;
      setGarageDoorProgress(
        mesh,
        door,
        garageDoorProgress(network, door.animationMs, serverTimeMs)
      );
    }
    return this.activeInteriorId;
  }

  destroy(): void {
    for (const group of this.structures.values()) disposeGroup(group);
    this.structures.clear();
    this.garageDoors.clear();
  }

  private create(definition: SeamlessInteriorDefinition): void {
    const structure = createStructure(definition);
    if (definition.garageDoor) {
      const door = createGarageDoor(definition.garageDoor, definition.floorZ);
      this.garageDoors.set(definition.garageDoor.id, door);
      structure.add(door);
    }
    this.structures.set(definition.id, structure);
    this.scene.add(structure);
  }
}

function createGarageDoor(door: SeamlessGarageDoorDefinition, floorZ: number): THREE.Group {
  const assembly = new THREE.Group();
  assembly.name = `garage-door:${door.id}`;
  assembly.position.set(door.x, serverYToScene(door.y), floorZ + door.height);
  const curtain = new THREE.Group();
  curtain.name = 'garage-door-curtain';
  assembly.add(curtain);
  const verticalSide = door.side === 'east' || door.side === 'west';
  const inward = entranceInwardVector(door.side);
  const sceneOutward = {x: -inward.x, y: inward.y};
  const panelDepth = door.height / 8;
  for (let index = 0; index < 4; index++) {
    const panel = unlitBox(
      verticalSide ? panelDepth - 3 : door.width - 6,
      verticalSide ? door.width - 6 : panelDepth - 3,
      7,
      index % 2 === 0 ? 0x7b8991 : 0x65737b,
      sceneOutward.x * (index + 0.5) * panelDepth,
      sceneOutward.y * (index + 0.5) * panelDepth,
      0
    );
    panel.name = `garage-door-panel:${index}`;
    curtain.add(panel);
  }

  assembly.add(unlitBox(
    verticalSide ? 18 : door.width + 22,
    verticalSide ? door.width + 22 : 18,
    11,
    0x20282d,
    0,
    0,
    2
  ));
  const markerOffset = door.width / 2 + 6;
  for (const direction of [-1, 1]) {
    const marker = unlitBox(
      verticalSide ? 20 : 13,
      verticalSide ? 13 : 20,
      13,
      0xf0b52f,
      verticalSide ? 0 : markerOffset * direction,
      verticalSide ? markerOffset * direction : 0,
      4
    );
    marker.name = 'garage-door-marker';
    assembly.add(marker);
  }
  setGarageDoorProgress(assembly, door, 0);
  return assembly;
}

const CLOSED_DOOR_PROJECTION = 0.12;

export function setGarageDoorProgress(
  assembly: THREE.Group,
  door: Pick<SeamlessGarageDoorDefinition, 'side'>,
  progress: number
): void {
  const value = Math.max(0, Math.min(1, progress));
  const eased = value * value * (3 - 2 * value);
  const projection = CLOSED_DOOR_PROJECTION + (1 - CLOSED_DOOR_PROJECTION) * eased;
  const curtain = assembly.getObjectByName('garage-door-curtain');
  if (curtain) {
    const verticalSide = door.side === 'east' || door.side === 'west';
    curtain.scale.set(verticalSide ? projection : 1, verticalSide ? 1 : projection, 1);
  }
  assembly.userData.progress = value;
  assembly.userData.projection = projection;
}

function createStructure(definition: SeamlessInteriorDefinition): THREE.Group {
  const group = new THREE.Group();
  group.name = `seamless-interior:${definition.id}`;
  const {bounds, floorZ} = definition;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = serverYToScene((bounds.minY + bounds.maxY) / 2);

  for (const footprint of definition.footprints) {
    const width = footprint.maxX - footprint.minX;
    const depth = footprint.maxY - footprint.minY;
    const x = (footprint.minX + footprint.maxX) / 2;
    const y = serverYToScene((footprint.minY + footprint.maxY) / 2);
    group.add(box(width, depth, 2, 0x1d2728, x, y, floorZ - 1));
    group.add(box(width - 28, depth - 28, 1, 0x9aa19a, x, y, floorZ + 0.5));
    addFloorTiles(group, footprint, floorZ);
  }
  for (const connector of definition.floorConnectors) {
    const width = connector.maxX - connector.minX;
    const depth = connector.maxY - connector.minY;
    group.add(box(
      width,
      depth,
      1,
      0x9aa19a,
      (connector.minX + connector.maxX) / 2,
      serverYToScene((connector.minY + connector.maxY) / 2),
      floorZ + 0.5
    ));
  }

  if (definition.kind === 'garage') addGarageBays(group, definition, floorZ);

  for (const obstacle of definition.obstacles) addObstacle(group, obstacle, floorZ);

  const entrance = definition.entrance;
  const inward = entranceInwardVector(entrance.side);
  const verticalSide = entrance.side === 'east' || entrance.side === 'west';
  const thresholdWidth = Math.max(24, entrance.width - 2);
  const overheadWidth = entrance.width + 12;
  group.add(box(
    verticalSide ? 28 : thresholdWidth,
    verticalSide ? thresholdWidth : 28,
    1.2,
    0xf0b52f,
    entrance.x + inward.x * 5,
    serverYToScene(entrance.y + inward.y * 5),
    floorZ + 0.8
  ));
  group.add(box(
    verticalSide ? 24 : overheadWidth,
    verticalSide ? overheadWidth : 24,
    5,
    0xd94b45,
    entrance.x + inward.x * 4,
    serverYToScene(entrance.y + inward.y * 4),
    floorZ + 48
  ));

  const storefront = textPlane(definition.signage.exterior, '#f8f4e8', 150, 28);
  storefront.position.set(
    entrance.x + inward.x * 54,
    serverYToScene(entrance.y + inward.y * 54),
    floorZ + 51
  );
  group.add(storefront);

  if (definition.signage.service) {
    const service = textPlane(definition.signage.service, '#d9ffef', 116, 26);
    const counter = definition.obstacles.find(({kind}) => kind === 'counter');
    service.position.set(
      counter ? (counter.minX + counter.maxX) / 2 : centerX,
      serverYToScene(counter ? counter.maxY + 10 : (bounds.minY + bounds.maxY) / 2),
      floorZ + 33
    );
    group.add(service);
  }
  return group;
}

function addGarageBays(
  group: THREE.Group,
  definition: SeamlessInteriorDefinition,
  floorZ: number
): void {
  const footprint = definition.footprints.reduce((largest, candidate) => (
    candidate.maxX - candidate.minX > largest.maxX - largest.minX ? candidate : largest
  ));
  const bayCount = Math.max(1, Math.min(3, Math.floor((footprint.maxX - footprint.minX) / 150)));
  const usableWidth = footprint.maxX - footprint.minX - 88;
  const bayWidth = usableWidth / bayCount;
  const centerY = serverYToScene((footprint.minY + footprint.maxY) / 2 + 18);
  const depth = Math.max(40, footprint.maxY - footprint.minY - 96);
  for (let index = 0; index <= bayCount; index++) {
    const x = footprint.minX + 44 + bayWidth * index;
    group.add(box(4, depth, 0.5, 0xe6b93f, x, centerY, floorZ + 1.4));
  }
}

function entranceInwardVector(
  side: SeamlessInteriorDefinition['entrance']['side']
): {x: number; y: number} {
  if (side === 'north') return {x: 0, y: 1};
  if (side === 'east') return {x: -1, y: 0};
  if (side === 'south') return {x: 0, y: -1};
  return {x: 1, y: 0};
}

function addFloorTiles(group: THREE.Group, bounds: WorldRect, floorZ: number): void {
  for (let x = bounds.minX + 46; x < bounds.maxX - 28; x += 44) {
    group.add(box(2, bounds.maxY - bounds.minY - 34, 0.25, 0x777f79, x, serverYToScene(
      (bounds.minY + bounds.maxY) / 2
    ), floorZ + 1.05));
  }
  for (let y = bounds.minY + 46; y < bounds.maxY - 28; y += 44) {
    group.add(box(bounds.maxX - bounds.minX - 34, 2, 0.25, 0x777f79, (
      bounds.minX + bounds.maxX
    ) / 2, serverYToScene(y), floorZ + 1.05));
  }
}

function addObstacle(
  group: THREE.Group,
  obstacle: SeamlessInteriorObstacle,
  floorZ: number
): void {
  const width = obstacle.maxX - obstacle.minX;
  const depth = obstacle.maxY - obstacle.minY;
  const x = (obstacle.minX + obstacle.maxX) / 2;
  const y = serverYToScene((obstacle.minY + obstacle.maxY) / 2);
  group.add(box(width, depth, obstacle.height, obstacle.color, x, y, floorZ + obstacle.height / 2));
  if (obstacle.kind === 'shelf') {
    group.add(box(width - 6, depth - 6, 3, 0xe8c56b, x, y, floorZ + obstacle.height + 2));
  } else if (obstacle.kind === 'counter') {
    group.add(box(width - 4, depth - 4, 4, 0x73c5b0, x, y, floorZ + obstacle.height + 2));
  } else if (obstacle.kind === 'cooler') {
    group.add(box(width - 4, depth - 8, 3, 0x8ee9f0, x + 1, y, floorZ + obstacle.height + 2));
  }
}

function box(
  width: number,
  depth: number,
  height: number,
  color: number,
  x: number,
  y: number,
  z: number
): THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, depth, height),
    new THREE.MeshLambertMaterial({color})
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function unlitBox(
  width: number,
  depth: number,
  height: number,
  color: number,
  x: number,
  y: number,
  z: number
): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, depth, height),
    new THREE.MeshBasicMaterial({color})
  );
  mesh.position.set(x, y, z);
  mesh.renderOrder = 18;
  return mesh;
}

function textPlane(text: string, color: string, width: number, height: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Seamless interior label canvas is unavailable.');
  context.font = '900 42px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 10;
  context.strokeStyle = '#111719';
  context.strokeText(text, 256, 48);
  context.fillStyle = color;
  context.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 25;
  return mesh;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
      material.dispose();
    }
  });
  group.removeFromParent();
}

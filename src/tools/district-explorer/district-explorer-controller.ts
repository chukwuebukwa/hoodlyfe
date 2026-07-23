import * as THREE from 'three';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {
  districtMapAsset,
  districtGeometryAsset,
  type DistrictDefinition
} from '../../../shared/content/district-catalog.ts';
import {ClientCollisionMap} from '../../game/world/client-collision-map.ts';
import type {LocalPlaytestRevision} from '../level-editor/playtest-revision.ts';
import {MapChunkStreamer} from '../../game/presentation/map/chunk-streamer.ts';
import type {WorldGeometryManifest} from '../../game/presentation/map/geometry-format.ts';
import {
  serverPedestrianAngleToScene,
  serverYToScene
} from '../../game/presentation/scene-policy.ts';

interface DistrictMetadata {
  source: string;
  tileSize: number;
  origin: {x: number; y: number};
  size: {width: number; height: number};
  spawn: {x: number; y: number};
}

export interface DistrictExplorerStatus {
  x: number;
  y: number;
  loadedChunks: number;
  totalChunks: number;
  triangles: number;
}

type Direction = 'up' | 'down' | 'left' | 'right';

const PLAYER_SPEED = 220;
const PLAYER_RADIUS = 18;
const CAMERA_HEIGHT = 700;
const STREAM_HALF_EXTENT = 720;

export class DistrictExplorerController {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 20_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly keys = new Set<string>();
  private readonly directions = new Set<Direction>();
  private readonly mapOccluders = new Map<string, THREE.Group>();
  private mapStreamer?: MapChunkStreamer;
  private collision?: ClientCollisionMap;
  private manifest?: WorldGeometryManifest;
  private player?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private playerTexture?: THREE.Texture;
  private x = 0;
  private y = 0;
  private angle = -Math.PI / 2;
  private frame = 0;
  private previousTime = 0;
  private statusTime = 0;
  private destroyed = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly district: DistrictDefinition,
    private readonly onStatus: (status: DistrictExplorerStatus) => void,
    private readonly revision?: LocalPlaytestRevision
  ) {
    this.renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.id = 'district-explorer-canvas';
    this.renderer.domElement.setAttribute('aria-label', `${district.label} local walk preview`);
    this.parent.replaceChildren(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x07090a);
  }

  async start(): Promise<void> {
    const [mapStreamer, metadata, collision, texture] = await Promise.all([
      MapChunkStreamer.create(
        this.scene,
        this.mapOccluders,
        districtGeometryAsset(this.district, 'world.json')
      ),
      loadJson<DistrictMetadata>(districtMapAsset(this.district, 'district-map.metadata.json')),
      this.revision
        ? Promise.resolve(ClientCollisionMap.fromGrid({
          width: this.revision.document.map.width,
          height: this.revision.document.map.height,
          tileSize: this.revision.document.map.tileSize,
          collisions: this.revision.document.layers.collision
        }))
        : ClientCollisionMap.load(districtMapAsset(this.district, 'district-map.json')),
      new THREE.TextureLoader().loadAsync('/assets/original/sprites/player-base.png')
    ]);
    if (this.destroyed) {
      mapStreamer.destroy();
      texture.dispose();
      return;
    }
    this.mapStreamer = mapStreamer;
    this.manifest = mapStreamer.manifest;
    this.collision = collision;
    if (this.revision) assertRevisionMatchesSource(this.revision, metadata);
    const authoredSpawn = this.revision?.document.spawns.find((spawn) => (
      spawn.kind === 'player' && spawn.enabled
    ));
    const spawn = chooseExplorerSpawn(
      authoredSpawn ? {x: authoredSpawn.x, y: authoredSpawn.y} : metadata.spawn,
      collision,
      mapStreamer.manifest.blockSize
    );
    this.x = spawn.x;
    this.y = spawn.y;
    this.playerTexture = texture;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.flipY = true;
    this.player = createPlayerMesh(texture);
    this.scene.add(this.player);
    this.scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x29322c, 2.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(-600, 450, 1_200);
    this.scene.add(sun);
    this.camera.up.set(0, 1, 0);
    this.resize();
    this.placePlayer(false);
    await mapStreamer.prime(this.x, this.y, STREAM_HALF_EXTENT, STREAM_HALF_EXTENT);
    this.bind();
    this.previousTime = performance.now();
    requestAnimationFrame(this.render);
  }

  setDirection(direction: Direction, active: boolean): void {
    if (active) {
      if (!this.directions.has(direction)) this.nudge(direction);
      this.directions.add(direction);
    }
    else this.directions.delete(direction);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unbind();
    this.mapStreamer?.destroy();
    this.player?.geometry.dispose();
    this.player?.material.map?.dispose();
    this.player?.material.dispose();
    this.playerTexture?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly render = (now: number): void => {
    if (this.destroyed) return;
    const delta = Math.min(0.05, Math.max(0, (now - this.previousTime) / 1_000));
    this.previousTime = now;
    this.updateMovement(delta, now);
    this.mapStreamer?.update(this.x, this.y, STREAM_HALF_EXTENT, STREAM_HALF_EXTENT, now);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.dataset.localX = this.x.toFixed(2);
    this.renderer.domElement.dataset.localY = this.y.toFixed(2);
    this.renderer.domElement.dataset.loadedChunks = String(this.mapStreamer?.snapshot().loaded ?? 0);
    if (now - this.statusTime > 250) {
      this.statusTime = now;
      const streaming = this.mapStreamer?.snapshot();
      this.onStatus({
        x: this.x,
        y: this.y,
        loadedChunks: streaming?.loaded ?? 0,
        totalChunks: streaming?.totalChunks ?? 0,
        triangles: streaming?.loadedTriangles ?? 0
      });
    }
    requestAnimationFrame(this.render);
  };

  private updateMovement(delta: number, now: number): void {
    let dx = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.directions.has('right')) -
      Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.directions.has('left'));
    let dy = Number(this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.directions.has('down')) -
      Number(this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.directions.has('up'));
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      dx /= length;
      dy /= length;
      this.move(dx, dy, PLAYER_SPEED * delta);
      this.frame = 1 + Math.floor(now / 115) % 2;
    } else {
      this.frame = 0;
    }
    this.placePlayer(length > 0);
  }

  private nudge(direction: Direction): void {
    const vector = direction === 'up' ? {x: 0, y: -1}
      : direction === 'down' ? {x: 0, y: 1}
        : direction === 'left' ? {x: -1, y: 0}
          : {x: 1, y: 0};
    this.move(vector.x, vector.y, PLAYER_SPEED / 30);
    this.placePlayer(true);
  }

  private move(dx: number, dy: number, distance: number): void {
    const nextX = this.x + dx * distance;
    const nextY = this.y + dy * distance;
    if (this.collision?.canOccupy(STREET_SPACE_ID, nextX, this.y, PLAYER_RADIUS)) this.x = nextX;
    if (this.collision?.canOccupy(STREET_SPACE_ID, this.x, nextY, PLAYER_RADIUS)) this.y = nextY;
    this.angle = Math.atan2(dy, dx);
  }

  private placePlayer(moving: boolean): void {
    const player = this.player;
    if (!player) return;
    player.position.set(this.x, serverYToScene(this.y), this.surfaceHeightAt(this.x, this.y) + 4);
    player.rotation.z = serverPedestrianAngleToScene(this.angle);
    setPlayerFrame(player, moving ? this.frame : 0);
  }

  private placeCamera(): void {
    const ground = this.surfaceHeightAt(this.x, this.y);
    this.camera.position.set(this.x, serverYToScene(this.y), ground + CAMERA_HEIGHT);
    this.camera.lookAt(this.x, serverYToScene(this.y), ground);
  }

  private surfaceHeightAt(x: number, y: number): number {
    const manifest = this.manifest;
    if (!manifest) return 0;
    const column = clamp(Math.floor(x / manifest.blockSize), 0, manifest.surfaces.width - 1);
    const row = clamp(Math.floor(y / manifest.blockSize), 0, manifest.surfaces.height - 1);
    return manifest.surfaces.values[row * manifest.surfaces.width + column] * manifest.blockSize;
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.parent.clientWidth);
    const height = Math.max(1, this.parent.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
      if (!this.keys.has(event.code)) {
        const direction = event.code === 'KeyW' || event.code === 'ArrowUp' ? 'up'
          : event.code === 'KeyS' || event.code === 'ArrowDown' ? 'down'
            : event.code === 'KeyA' || event.code === 'ArrowLeft' ? 'left'
              : 'right';
        this.nudge(direction);
      }
      this.keys.add(event.code);
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private bind(): void {
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
  }

  private unbind(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
  }
}

function assertRevisionMatchesSource(
  revision: LocalPlaytestRevision,
  metadata: DistrictMetadata
): void {
  const map = revision.document.map;
  if (
    map.source !== metadata.source ||
    map.width !== metadata.size.width ||
    map.height !== metadata.size.height ||
    map.tileSize !== metadata.tileSize ||
    map.origin.x !== metadata.origin.x ||
    map.origin.y !== metadata.origin.y
  ) {
    throw new Error('Play Draft was created from a different district source. Return to the editor and create a new revision.');
  }
}

function createPlayerMesh(source: THREE.Texture): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const texture = source.clone();
  texture.needsUpdate = true;
  texture.repeat.set(1 / 3, 1 / 3);
  texture.offset.set(0, 2 / 3);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(54, 54), material);
  mesh.renderOrder = 20;
  return mesh;
}

function setPlayerFrame(mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, frame: number): void {
  if (mesh.userData.frame === frame) return;
  mesh.userData.frame = frame;
  mesh.material.map?.offset.set((frame % 3) / 3, 2 / 3);
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function chooseExplorerSpawn(
  spawn: {x: number; y: number},
  collision: ClientCollisionMap,
  blockSize: number
): {x: number; y: number} {
  const candidates = [
    {x: spawn.x, y: spawn.y + blockSize},
    spawn,
    {x: spawn.x + blockSize, y: spawn.y},
    {x: spawn.x - blockSize, y: spawn.y},
    {x: spawn.x, y: spawn.y - blockSize}
  ];
  return candidates.find(({x, y}) => collision.canOccupy(STREET_SPACE_ID, x, y, PLAYER_RADIUS)) ?? spawn;
}

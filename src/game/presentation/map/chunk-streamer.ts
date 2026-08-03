import * as THREE from 'three';
import {
  MAP_STREAMING,
  selectMapChunkInterest,
  type MapChunkInterest
} from './streaming-policy.ts';
import type {
  WorldGeometryChunkDescriptor,
  WorldGeometryChunkPayload,
  WorldGeometryManifest,
  WorldGeometryVertex
} from './geometry-format.ts';
import {atlasUv, faceBrightness, serverYToScene} from '../scene-policy.ts';

interface LoadedChunk {
  descriptor: WorldGeometryChunkDescriptor;
  base: THREE.Group;
  occluders: Array<{parent: THREE.Group; mesh: THREE.Mesh}>;
}

interface PendingChunk {
  controller: AbortController;
  promise: Promise<void>;
}

export interface MapStreamingSnapshot {
  revision: string;
  loaded: number;
  loading: number;
  queued: number;
  desired: number;
  retained: number;
  failed: number;
  loadedTriangles: number;
  totalChunks: number;
  totalTriangles: number;
}

export class MapChunkStreamer {
  private readonly root = new THREE.Group();
  private readonly loaded = new Map<string, LoadedChunk>();
  private readonly pending = new Map<string, PendingChunk>();
  private readonly failed = new Set<string>();
  private readonly desired = new Set<string>();
  private readonly retained = new Set<string>();
  private queue: WorldGeometryChunkDescriptor[] = [];
  private lastFocus?: {x: number; y: number; at: number};
  private lastSelectionKey = '';
  private destroyed = false;
  private readonly opaqueMaterial: THREE.MeshLambertMaterial;
  private readonly alphaMaterial: THREE.MeshLambertMaterial;

  private constructor(
    private readonly scene: THREE.Scene,
    readonly manifest: WorldGeometryManifest,
    private readonly manifestUrl: URL,
    private readonly texture: THREE.Texture,
    private readonly mapOccluders: Map<string, THREE.Group>
  ) {
    this.root.name = 'streamed-map';
    this.scene.add(this.root);
    const common = {map: texture, vertexColors: true, side: THREE.DoubleSide} as const;
    this.opaqueMaterial = new THREE.MeshLambertMaterial(common);
    this.alphaMaterial = new THREE.MeshLambertMaterial({
      ...common,
      alphaTest: 0.05,
      transparent: true,
      depthWrite: true
    });
    for (const definition of manifest.occluders) {
      const group = new THREE.Group();
      group.name = `roof:${definition.id}`;
      group.userData.triangleCount = definition.triangleCount;
      this.mapOccluders.set(definition.id, group);
      this.scene.add(group);
    }
  }

  static async create(
    scene: THREE.Scene,
    mapOccluders: Map<string, THREE.Group>,
    manifestPath = '/assets/maps/geometry/world.json'
  ): Promise<MapChunkStreamer> {
    const manifestUrl = new URL(manifestPath, window.location.origin);
    const response = await fetch(manifestUrl);
    if (!response.ok) throw new Error(`World geometry manifest failed to load (${response.status}).`);
    const manifest = await response.json() as WorldGeometryManifest;
    validateManifest(manifest);
    const textureUrl = new URL(manifest.atlas.image, manifestUrl).toString();
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    texture.flipY = false;
    return new MapChunkStreamer(scene, manifest, manifestUrl, texture, mapOccluders);
  }

  async prime(
    focusX: number,
    focusY: number,
    halfWidth: number,
    halfHeight: number,
    nowMs = performance.now()
  ): Promise<void> {
    const interests = this.select(focusX, focusY, halfWidth, halfHeight, nowMs);
    this.applyInterest(interests);
    const visible = interests.filter((interest) => interest.tier === 'visible');
    for (let offset = 0; offset < visible.length; offset += MAP_STREAMING.maximumConcurrentLoads) {
      const batch = visible.slice(offset, offset + MAP_STREAMING.maximumConcurrentLoads);
      await Promise.all(batch.map(({descriptor}) => this.fetchAndInstall(descriptor)));
    }
    this.rebuildQueue(interests);
    this.pump();
  }

  update(
    focusX: number,
    focusY: number,
    halfWidth: number,
    halfHeight: number,
    nowMs = performance.now()
  ): void {
    if (this.destroyed) return;
    const chunkWorldSize = this.manifest.blockSize * this.manifest.chunkSize;
    const key = [
      Math.floor(focusX / (chunkWorldSize / 4)),
      Math.floor(focusY / (chunkWorldSize / 4)),
      Math.round(halfWidth / 64),
      Math.round(halfHeight / 64)
    ].join(':');
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    const interests = this.select(focusX, focusY, halfWidth, halfHeight, nowMs);
    this.applyInterest(interests);
    this.rebuildQueue(interests);
    this.pump();
  }

  snapshot(): MapStreamingSnapshot {
    let loadedTriangles = 0;
    for (const loaded of this.loaded.values()) loadedTriangles += loaded.descriptor.triangleCount;
    return {
      revision: this.manifest.revision,
      loaded: this.loaded.size,
      loading: this.pending.size,
      queued: this.queue.length,
      desired: this.desired.size,
      retained: this.retained.size,
      failed: this.failed.size,
      loadedTriangles,
      totalChunks: this.manifest.chunks.length,
      totalTriangles: this.manifest.triangleCount
    };
  }

  pickWorldPoint(raycaster: THREE.Raycaster): THREE.Vector3 | undefined {
    const targets: THREE.Object3D[] = [];
    for (const loaded of this.loaded.values()) {
      targets.push(...loaded.base.children);
      for (const {parent, mesh} of loaded.occluders) {
        if (parent.visible && mesh.visible) targets.push(mesh);
      }
    }
    return raycaster.intersectObjects(targets, false)[0]?.point.clone();
  }

  destroy(): void {
    this.destroyed = true;
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
    for (const id of [...this.loaded.keys()]) this.unload(id);
    for (const group of this.mapOccluders.values()) group.removeFromParent();
    this.mapOccluders.clear();
    this.root.removeFromParent();
    this.opaqueMaterial.dispose();
    this.alphaMaterial.dispose();
    this.texture.dispose();
  }

  private select(
    focusX: number,
    focusY: number,
    halfWidth: number,
    halfHeight: number,
    nowMs: number
  ): MapChunkInterest[] {
    const previous = this.lastFocus;
    const elapsedSeconds = previous ? Math.max(1 / 120, (nowMs - previous.at) / 1000) : 0;
    const chunkWorldSize = this.manifest.blockSize * this.manifest.chunkSize;
    const maximumLead = chunkWorldSize * MAP_STREAMING.maximumLookaheadChunks;
    const leadX = previous
      ? clamp((focusX - previous.x) / elapsedSeconds * MAP_STREAMING.lookaheadSeconds, -maximumLead, maximumLead)
      : 0;
    const leadY = previous
      ? clamp((focusY - previous.y) / elapsedSeconds * MAP_STREAMING.lookaheadSeconds, -maximumLead, maximumLead)
      : 0;
    this.lastFocus = {x: focusX, y: focusY, at: nowMs};
    return selectMapChunkInterest({
      chunks: this.manifest.chunks,
      blockSize: this.manifest.blockSize,
      chunkSize: this.manifest.chunkSize,
      focusX,
      focusY,
      halfWidth,
      halfHeight,
      lookaheadX: focusX + leadX,
      lookaheadY: focusY + leadY
    });
  }

  private applyInterest(interests: readonly MapChunkInterest[]): void {
    this.desired.clear();
    this.retained.clear();
    for (const interest of interests) {
      this.retained.add(interest.descriptor.id);
      if (interest.tier !== 'retained') this.desired.add(interest.descriptor.id);
    }
    for (const [id, pending] of this.pending) {
      if (this.desired.has(id)) continue;
      pending.controller.abort();
      this.pending.delete(id);
    }
    for (const id of [...this.loaded.keys()]) {
      if (!this.retained.has(id)) this.unload(id);
    }
  }

  private rebuildQueue(interests: readonly MapChunkInterest[]): void {
    this.queue = interests
      .filter(({tier, descriptor}) => (
        tier !== 'retained' && !this.loaded.has(descriptor.id) && !this.pending.has(descriptor.id)
      ))
      .map(({descriptor}) => descriptor);
  }

  private pump(): void {
    while (
      !this.destroyed &&
      this.pending.size < MAP_STREAMING.maximumConcurrentLoads &&
      this.queue.length > 0
    ) {
      const descriptor = this.queue.shift();
      if (!descriptor || !this.desired.has(descriptor.id)) continue;
      void this.fetchAndInstall(descriptor).finally(() => this.pump());
    }
  }

  private async fetchAndInstall(descriptor: WorldGeometryChunkDescriptor): Promise<void> {
    if (this.loaded.has(descriptor.id) || this.pending.has(descriptor.id) || this.destroyed) return;
    const controller = new AbortController();
    const promise = this.loadPayload(descriptor, controller.signal)
      .then((payload) => {
        if (!this.destroyed && this.retained.has(descriptor.id)) this.install(descriptor, payload);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        this.failed.add(descriptor.id);
        console.error(`Map chunk ${descriptor.id} failed to load.`, error);
      })
      .finally(() => {
        if (this.pending.get(descriptor.id)?.controller === controller) this.pending.delete(descriptor.id);
      });
    this.pending.set(descriptor.id, {controller, promise});
    await promise;
  }

  private async loadPayload(
    descriptor: WorldGeometryChunkDescriptor,
    signal: AbortSignal
  ): Promise<WorldGeometryChunkPayload> {
    const response = await fetch(new URL(descriptor.file, this.manifestUrl), {signal});
    if (!response.ok) throw new Error(`Map chunk request failed (${response.status}).`);
    const payload = await response.json() as WorldGeometryChunkPayload;
    if (
      payload.column !== descriptor.column || payload.row !== descriptor.row ||
      payload.x !== descriptor.x || payload.y !== descriptor.y || payload.size !== descriptor.size
    ) throw new Error('Map chunk coordinates do not match the manifest.');
    return payload;
  }

  private install(descriptor: WorldGeometryChunkDescriptor, payload: WorldGeometryChunkPayload): void {
    if (this.loaded.has(descriptor.id)) return;
    const base = new THREE.Group();
    base.name = `map-chunk:${descriptor.id}`;
    base.position.set(
      descriptor.x * this.manifest.blockSize,
      serverYToScene(descriptor.y * this.manifest.blockSize),
      0
    );
    base.add(this.createMesh(payload.vertices, payload.opaqueIndices, payload.alphaTestedIndices));
    this.root.add(base);
    const occluders: LoadedChunk['occluders'] = [];
    for (const authored of payload.occluders) {
      const parent = this.mapOccluders.get(authored.id);
      if (!parent) continue;
      const mesh = this.createMesh(
        payload.vertices,
        authored.opaqueIndices,
        authored.alphaTestedIndices
      );
      mesh.name = `roof:${authored.id}:${descriptor.id}`;
      mesh.position.copy(base.position);
      parent.add(mesh);
      occluders.push({parent, mesh});
    }
    this.failed.delete(descriptor.id);
    this.loaded.set(descriptor.id, {descriptor, base, occluders});
  }

  private createMesh(
    vertices: readonly WorldGeometryVertex[],
    opaqueIndices: readonly number[],
    alphaIndices: readonly number[]
  ): THREE.Mesh {
    const positions = new Float32Array(vertices.length * 3);
    const uvs = new Float32Array(vertices.length * 2);
    const colors = new Float32Array(vertices.length * 3);
    for (let index = 0; index < vertices.length; index++) {
      const vertex = vertices[index];
      const positionOffset = index * 3;
      positions[positionOffset] = vertex.x * this.manifest.blockSize;
      positions[positionOffset + 1] = serverYToScene(vertex.y * this.manifest.blockSize);
      positions[positionOffset + 2] = vertex.z * this.manifest.blockSize;
      const [u, v] = atlasUv(vertex, this.manifest.atlas);
      const uvOffset = index * 2;
      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = v;
      const brightness = faceBrightness(vertex.shade);
      colors[positionOffset] = brightness;
      colors[positionOffset + 1] = brightness;
      colors[positionOffset + 2] = brightness;
    }
    const indices = [...opaqueIndices, ...alphaIndices];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.addGroup(0, opaqueIndices.length, 0);
    geometry.addGroup(opaqueIndices.length, alphaIndices.length, 1);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, [this.opaqueMaterial, this.alphaMaterial]);
  }

  private unload(id: string): void {
    const loaded = this.loaded.get(id);
    if (!loaded) return;
    loaded.base.removeFromParent();
    loaded.base.traverse(disposeGeometry);
    for (const {mesh} of loaded.occluders) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.loaded.delete(id);
  }
}

function validateManifest(manifest: WorldGeometryManifest): void {
  if (manifest.version !== 1) throw new Error(`Unsupported world geometry manifest ${manifest.version}.`);
  if (manifest.blockSize <= 0 || manifest.chunkSize <= 0) throw new Error('World geometry dimensions are invalid.');
  if (manifest.surfaces.values.length !== manifest.size.width * manifest.size.height) {
    throw new Error('World geometry surface grid is incomplete.');
  }
  const expectedChunks = manifest.size.width / manifest.chunkSize *
    (manifest.size.height / manifest.chunkSize);
  if (!Number.isInteger(expectedChunks) || manifest.chunks.length !== expectedChunks) {
    throw new Error('World geometry chunk grid is incomplete.');
  }
  const ids = new Set(manifest.chunks.map((chunk) => chunk.id));
  if (ids.size !== manifest.chunks.length) throw new Error('World geometry chunk identifiers are not unique.');
}

function disposeGeometry(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh) object.geometry.dispose();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

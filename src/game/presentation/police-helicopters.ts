import * as THREE from 'three';
import {STREET_GROUND_SURFACE_ID} from '../../../shared/world/surface-map.ts';
import type {DistrictNetworkState, NetworkPoliceHelicopter} from '../types.ts';
import {serverVehicleAngleToScene, serverYToScene} from './scene-policy.ts';
import {
  createPoliceSearchlight,
  disposePoliceSearchlight,
  policeSearchlightDetailForDistance,
  updatePoliceSearchlight,
  type PoliceSearchlight
} from './effects/police-searchlight.ts';

interface RenderedPoliceHelicopter {
  sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  searchlight: PoliceSearchlight;
  x: number;
  y: number;
  altitude: number;
  frameIndex: number;
  lastUpdateAt: number;
}

interface PoliceHelicopterViewer {
  x: number;
  y: number;
}

const FRAME_DURATION_MS = 90;
const HELICOPTER_SIZE = 178;

export class PoliceHelicopterPresentation {
  private readonly rendered = new Map<string, RenderedPoliceHelicopter>();
  private readonly searchlightSource = new THREE.Vector3();
  private readonly searchlightTarget = new THREE.Vector3();

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly frames: readonly THREE.Texture[],
    private readonly surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number
  ) {}

  static async create(
    scene: THREE.Scene,
    surfaceHeightAt: (x: number, y: number, surfaceId?: string) => number,
    assetRoot = '/assets'
  ): Promise<PoliceHelicopterPresentation> {
    const loader = new THREE.TextureLoader();
    const frames = await Promise.all([1, 2, 3, 4].map((frame) => (
      loader.loadAsync(`${assetRoot}/custom/police/helicopter/hover-${frame}.png`)
    )));
    for (const texture of frames) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
    }
    return new PoliceHelicopterPresentation(scene, frames, surfaceHeightAt);
  }

  synchronize(
    state: DistrictNetworkState,
    nowMs: number,
    localSpaceId = 'street',
    viewer?: PoliceHelicopterViewer
  ): void {
    if (localSpaceId !== 'street') {
      this.clearRendered();
      return;
    }
    const present = new Set<string>();
    for (const helicopter of state.policeHelicopters?.values() ?? []) {
      present.add(helicopter.id);
      this.synchronizeHelicopter(helicopter, nowMs, viewer);
    }
    for (const id of this.rendered.keys()) {
      if (!present.has(id)) this.remove(id);
    }
  }

  destroy(): void {
    this.clearRendered();
    for (const texture of this.frames) texture.dispose();
  }

  private synchronizeHelicopter(
    helicopter: NetworkPoliceHelicopter,
    nowMs: number,
    viewer?: PoliceHelicopterViewer
  ): void {
    let rendered = this.rendered.get(helicopter.id);
    if (!rendered) {
      rendered = this.createRendered(helicopter, nowMs);
      this.rendered.set(helicopter.id, rendered);
    }
    const elapsed = Math.max(0, Math.min(100, nowMs - rendered.lastUpdateAt));
    const follow = 1 - Math.exp(-elapsed / 75);
    rendered.x += (helicopter.x - rendered.x) * follow;
    rendered.y += (helicopter.y - rendered.y) * follow;
    rendered.altitude += (helicopter.altitude - rendered.altitude) * follow;
    rendered.lastUpdateAt = nowMs;

    const groundZ = this.surfaceHeightAt(
      rendered.x,
      rendered.y,
      STREET_GROUND_SURFACE_ID
    );
    rendered.sprite.position.set(
      rendered.x,
      serverYToScene(rendered.y),
      groundZ + rendered.altitude
    );
    rendered.sprite.rotation.z = serverVehicleAngleToScene(helicopter.angle);
    const frameIndex = Math.floor(
      (nowMs + helicopter.spawnedAt * 0.13) / FRAME_DURATION_MS
    ) % this.frames.length;
    if (frameIndex !== rendered.frameIndex) {
      rendered.sprite.material.map = this.frames[frameIndex];
      rendered.frameIndex = frameIndex;
    }
    rendered.sprite.material.opacity = helicopter.phase === 'depart'
      ? Math.max(0.35, helicopter.spotlightIntensity)
      : 1;

    const shadowOffset = Math.min(70, rendered.altitude * 0.24);
    rendered.shadow.position.set(
      rendered.x + shadowOffset,
      serverYToScene(rendered.y) - shadowOffset * 0.58,
      groundZ + 2.2
    );
    rendered.shadow.scale.set(
      1 + rendered.altitude / 420,
      1 + rendered.altitude / 520,
      1
    );
    rendered.shadow.material.opacity = Math.max(0.08, 0.32 - rendered.altitude / 1000);

    const detail = viewer
      ? policeSearchlightDetailForDistance(
        Math.hypot(rendered.x - viewer.x, rendered.y - viewer.y)
      )
      : 'full';
    const targetGroundZ = detail === 'hidden'
      ? 0
      : this.surfaceHeightAt(
        helicopter.spotlightX,
        helicopter.spotlightY,
        STREET_GROUND_SURFACE_ID
      );
    updatePoliceSearchlight(rendered.searchlight, {
      source: this.searchlightSource.set(
        rendered.sprite.position.x,
        rendered.sprite.position.y,
        rendered.sprite.position.z - 8
      ),
      target: this.searchlightTarget.set(
        helicopter.spotlightX,
        serverYToScene(helicopter.spotlightY),
        targetGroundZ + 3.2
      ),
      radius: helicopter.spotlightRadius,
      intensity: helicopter.spotlightIntensity,
      detail
    });
  }

  private createRendered(
    helicopter: NetworkPoliceHelicopter,
    nowMs: number
  ): RenderedPoliceHelicopter {
    const material = new THREE.MeshBasicMaterial({
      map: this.frames[0],
      transparent: true,
      alphaTest: 0.08,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(HELICOPTER_SIZE, HELICOPTER_SIZE),
      material
    );
    sprite.name = `police-helicopter:${helicopter.id}`;
    sprite.renderOrder = 21;

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(122, 76),
      new THREE.MeshBasicMaterial({
        color: 0x020507,
        transparent: true,
        opacity: 0.24,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    shadow.name = `police-helicopter-shadow:${helicopter.id}`;
    shadow.renderOrder = 8;
    const searchlight = createPoliceSearchlight();
    this.scene.add(shadow, searchlight.group, sprite);
    return {
      sprite,
      shadow,
      searchlight,
      x: helicopter.x,
      y: helicopter.y,
      altitude: helicopter.altitude,
      frameIndex: 0,
      lastUpdateAt: nowMs
    };
  }

  private clearRendered(): void {
    for (const id of [...this.rendered.keys()]) this.remove(id);
  }

  private remove(id: string): void {
    const rendered = this.rendered.get(id);
    if (!rendered) return;
    rendered.sprite.removeFromParent();
    rendered.sprite.geometry.dispose();
    rendered.sprite.material.dispose();
    rendered.shadow.removeFromParent();
    rendered.shadow.geometry.dispose();
    rendered.shadow.material.dispose();
    disposePoliceSearchlight(rendered.searchlight);
    this.rendered.delete(id);
  }
}

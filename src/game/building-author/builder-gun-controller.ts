import * as THREE from 'three';
import type {MapChunkStreamer} from '../presentation/map/chunk-streamer.ts';
import {serverYToScene} from '../presentation/scene-policy.ts';
import {
  authoredBuildingOverlapping,
  createBuildingAuthorDraft,
  nearestBuildingFacade,
  resolveBuildingCandidateAt,
  type BuilderTemplate,
  type BuildingAuthorDraft,
  type BuildingAuthorGrid,
  type BuildingCandidate,
  type BuildingFacadeEdge
} from './building-candidate-policy.ts';
import {
  SEAMLESS_INTERIORS,
  type SeamlessInteriorDefinition
} from '../../../shared/content/seamless-interior-catalog.ts';

interface BuilderGunControllerOptions {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly canvas: HTMLCanvasElement;
  readonly mapStreamer: MapChunkStreamer;
  readonly grid: BuildingAuthorGrid;
  readonly surfaceHeightAt: (x: number, y: number) => number;
  readonly playerPosition: () => {x: number; y: number} | undefined;
  readonly authoredBuildings?: readonly SeamlessInteriorDefinition[];
}

interface StoredBuildingDrafts {
  readonly version: 1;
  readonly drafts: BuildingAuthorDraft[];
}

const STORAGE_KEY = 'nock0.builder-gun-drafts-v1';
const AUTH_STORAGE_KEY = 'nock0.builder-gun-authorization';
const STORE_ENTRANCE_WIDTH = 56;
const GARAGE_ENTRANCE_WIDTH = 160;

export class BuilderGunController {
  private readonly panel = document.createElement('aside');
  private readonly root = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly beam = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color: 0x68e4ff, transparent: true, opacity: 0.9, depthTest: false})
  );
  private targetMesh?: THREE.Mesh;
  private facadeLines?: THREE.LineSegments;
  private entranceMesh?: THREE.Mesh;
  private fixtureGroup?: THREE.Group;
  private hover?: BuildingCandidate;
  private selected?: BuildingCandidate;
  private template?: BuilderTemplate;
  private draft?: BuildingAuthorDraft;
  private targetPoint?: {x: number; y: number; z: number};
  private equipped = false;
  private publishing = false;

  private constructor(private readonly options: BuilderGunControllerOptions) {
    this.root.name = 'builder-gun-preview';
    this.root.renderOrder = 90;
    this.beam.renderOrder = 91;
    this.beam.visible = false;
    this.root.add(this.beam);
    options.scene.add(this.root);
    this.createPanel();
    window.addEventListener('keydown', this.handleKeyDown);
    options.canvas.addEventListener('pointermove', this.handlePointerMove);
    options.canvas.addEventListener('pointerdown', this.handlePointerDown, true);
    options.canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  static async create(
    options: Omit<BuilderGunControllerOptions, 'grid'>,
    mapUrl: string,
    surfaces: readonly number[],
    tileSize: number
  ): Promise<BuilderGunController> {
    const response = await fetch(mapUrl);
    if (!response.ok) throw new Error(`Builder Gun map failed to load (${response.status}).`);
    const map = await response.json() as {
      width: number;
      height: number;
      tilewidth: number;
      layers: Array<{name: string; data?: number[]}>;
    };
    const collisions = map.layers.find((layer) => layer.name === 'collisions')?.data;
    if (!collisions || collisions.length !== map.width * map.height) {
      throw new Error('Builder Gun requires the district collision grid.');
    }
    return new BuilderGunController({
      ...options,
      grid: {
        width: map.width,
        height: map.height,
        tileSize: map.tilewidth || tileSize,
        collisions,
        surfaces
      }
    });
  }

  isEquipped(): boolean {
    return this.equipped;
  }

  update(): void {
    if (!this.equipped || !this.targetPoint) {
      this.beam.visible = false;
      return;
    }
    const player = this.options.playerPosition();
    if (!player) {
      this.beam.visible = false;
      return;
    }
    const positions = new Float32Array([
      player.x,
      serverYToScene(player.y),
      this.options.surfaceHeightAt(player.x, player.y) + 30,
      this.targetPoint.x,
      serverYToScene(this.targetPoint.y),
      this.targetPoint.z + 7
    ]);
    this.beam.geometry.dispose();
    this.beam.geometry = new THREE.BufferGeometry();
    this.beam.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.beam.visible = true;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    this.options.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.options.canvas.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.options.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.panel.remove();
    this.root.removeFromParent();
    this.root.traverse(disposeObject);
    this.options.canvas.classList.remove('builder-gun-equipped');
    document.querySelector('#weapon-hud')?.classList.remove('builder-gun-equipped');
  }

  private createPanel(): void {
    this.panel.id = 'builder-gun-panel';
    this.panel.className = 'hud-layer';
    this.panel.innerHTML = `
      <header>
        <div><span>QA AUTHORING</span><strong>BUILDER GUN</strong></div>
        <button type="button" data-builder-action="toggle" data-testid="builder-gun-toggle">EQUIP <kbd>G</kbd></button>
      </header>
      <section class="builder-gun-body hidden">
        <output data-builder-status>HOLSTERED</output>
        <div class="builder-gun-candidate">
          <span>Target</span><strong data-builder-candidate>None</strong>
        </div>
        <div class="builder-gun-templates" aria-label="Building template">
          <button type="button" data-builder-template="store" disabled>STORE</button>
          <button type="button" data-builder-template="garage" disabled>GARAGE</button>
        </div>
        <footer>
          <button type="button" data-builder-action="reset" disabled>RESET</button>
          <button type="button" data-builder-action="publish" disabled>PUBLISH INTERIOR</button>
        </footer>
      </section>
    `;
    this.panel.querySelector('[data-builder-action="toggle"]')?.addEventListener('click', this.toggle);
    this.panel.querySelector('[data-builder-action="reset"]')?.addEventListener('click', this.resetSelection);
    this.panel.querySelector('[data-builder-action="publish"]')?.addEventListener('click', this.publishDraft);
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-builder-template]')) {
      button.addEventListener('click', this.selectTemplate);
    }
    document.querySelector('#game-shell')?.append(this.panel);
  }

  private readonly toggle = (): void => {
    this.setEquipped(!this.equipped);
  };

  private setEquipped(equipped: boolean): void {
    this.equipped = equipped;
    this.panel.dataset.equipped = String(equipped);
    this.panel.querySelector('.builder-gun-body')?.classList.toggle('hidden', !equipped);
    const toggle = this.panel.querySelector<HTMLButtonElement>('[data-builder-action="toggle"]');
    if (toggle) toggle.innerHTML = equipped ? 'HOLSTER <kbd>G</kbd>' : 'EQUIP <kbd>G</kbd>';
    this.options.canvas.classList.toggle('builder-gun-equipped', equipped);
    document.querySelector('#weapon-hud')?.classList.toggle('builder-gun-equipped', equipped);
    this.root.visible = equipped;
    if (equipped) {
      if (this.draft) this.setStatus('Interior ready to publish');
      else if (this.selected && this.template) this.setStatus(`Click the ${this.template === 'garage' ? 'vehicle-width' : 'street-facing'} facade`);
      else if (this.selected) this.setStatus('Choose Store or Garage');
      else this.setStatus('Aim at a building roof');
    } else {
      this.beam.visible = false;
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (isFormTarget(event.target)) return;
    if (event.code === 'KeyG' && !event.repeat) {
      event.preventDefault();
      this.toggle();
      return;
    }
    if (event.code !== 'Escape' || !this.equipped) return;
    event.preventDefault();
    if (this.selected) this.resetSelection();
    else this.setEquipped(false);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.equipped) return;
    const point = this.pick(event);
    this.targetPoint = point;
    if (!point || this.selected) return;
    const candidate = resolveBuildingCandidateAt(this.options.grid, point.x, point.y);
    if (candidate?.id === this.hover?.id) return;
    this.hover = candidate;
    this.showCandidate(candidate);
    if (!candidate) this.setStatus('Aim at a solid building roof');
    else if (!candidate.valid) this.setStatus(candidate.reason ?? 'Building cannot be authored');
    else {
      const authored = authoredBuilding(candidate, this.options.authoredBuildings);
      this.setStatus(authored ? `Already authored · ${authored.label}` : 'Click to mark building');
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.equipped || event.button === 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = this.pick(event);
    if (!point) return;
    this.targetPoint = point;
    if (!this.selected) {
      const candidate = resolveBuildingCandidateAt(this.options.grid, point.x, point.y);
      this.hover = candidate;
      this.showCandidate(candidate);
      if (!candidate?.valid) {
        this.setStatus(candidate?.reason ?? 'No building at cursor');
        return;
      }
      const authored = authoredBuilding(candidate, this.options.authoredBuildings);
      if (authored) {
        this.setStatus(`Already authored · ${authored.label}`);
        return;
      }
      if (this.draft) {
        this.draft = undefined;
        this.clearDraftPreview();
        this.setPublishEnabled(false);
      }
      this.selected = candidate;
      this.setCandidateLabel(`${candidate.cells.length} tiles · ${candidate.floorZ}-${candidate.roofZ} high`);
      this.setTemplateButtonsEnabled(true);
      this.setResetEnabled(true);
      this.setStatus('Choose Store or Garage');
      return;
    }
    if (!this.template) {
      this.setStatus('Choose a building template');
      return;
    }
    const minimumWidth = this.template === 'garage' ? GARAGE_ENTRANCE_WIDTH : STORE_ENTRANCE_WIDTH;
    const facade = nearestBuildingFacade(this.selected, point.x, point.y, minimumWidth);
    if (!facade) {
      this.setStatus(`No facade fits a ${minimumWidth} px entrance`);
      return;
    }
    try {
      this.draft = createBuildingAuthorDraft(
        this.selected,
        this.template,
        facade,
        point.x,
        point.y,
        this.options.grid.tileSize
      );
      this.persistDraft(this.draft);
      this.showDraft(this.draft, facade);
      this.setPublishEnabled(true);
      this.releaseCompletedSelection();
      this.setStatus('Interior ready · publish or aim at another roof');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (!this.equipped) return;
    event.preventDefault();
    this.resetSelection();
  };

  private readonly selectTemplate = (event: Event): void => {
    if (!this.selected) return;
    const button = event.currentTarget as HTMLButtonElement;
    this.template = button.dataset.builderTemplate as BuilderTemplate;
    for (const candidate of this.panel.querySelectorAll<HTMLButtonElement>('[data-builder-template]')) {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    }
    this.clearDraftPreview();
    this.setPublishEnabled(false);
    this.setStatus(`Click the ${this.template === 'garage' ? 'vehicle-width' : 'street-facing'} facade`);
  };

  private readonly resetSelection = (): void => {
    this.selected = undefined;
    this.template = undefined;
    this.draft = undefined;
    this.hover = undefined;
    this.clearCandidatePreview();
    this.clearDraftPreview();
    this.setCandidateLabel('None');
    this.setTemplateButtonsEnabled(false);
    this.setResetEnabled(false);
    this.setPublishEnabled(false);
    for (const button of this.panel.querySelectorAll('[data-builder-template]')) {
      button.removeAttribute('aria-pressed');
    }
    this.setStatus('Aim at a building roof');
  };

  private releaseCompletedSelection(): void {
    this.selected = undefined;
    this.template = undefined;
    this.hover = undefined;
    this.setTemplateButtonsEnabled(false);
    for (const button of this.panel.querySelectorAll('[data-builder-template]')) {
      button.removeAttribute('aria-pressed');
    }
  }

  private readonly publishDraft = async (): Promise<void> => {
    if (!this.draft || this.publishing) return;
    this.publishing = true;
    this.setPublishEnabled(false);
    this.setStatus('Publishing interior...');
    try {
      let response = await postBuildingDraft(this.draft, readStoredAuthorization());
      if (response.status === 401) {
        const authorization = promptForAuthorization();
        if (!authorization) throw new Error('Publishing cancelled');
        sessionStorage.setItem(AUTH_STORAGE_KEY, authorization);
        response = await postBuildingDraft(this.draft, authorization);
      }
      const payload = await responsePayload(response) as {
        error?: string;
        buildingId?: string;
        triangleCount?: number;
        source?: 'bundled' | 'bucket';
      };
      if (!response.ok) {
        if (response.status === 401) sessionStorage.removeItem(AUTH_STORAGE_KEY);
        throw new Error(payload.error ?? `Publish failed (${response.status})`);
      }
      removeStoredDraft(this.draft.candidateId);
      const delayMs = payload.source === 'bucket' ? 16_000 : 1_500;
      this.setStatus(`Published ${payload.buildingId} · ${payload.triangleCount} roof triangles · reloading`);
      window.setTimeout(() => window.location.reload(), delayMs);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error));
      this.setPublishEnabled(true);
    } finally {
      this.publishing = false;
    }
  };

  private pick(event: PointerEvent): {x: number; y: number; z: number} | undefined {
    const bounds = this.options.canvas.getBoundingClientRect();
    this.pointer.set(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointer, this.options.camera);
    const point = this.options.mapStreamer.pickWorldPoint(this.raycaster);
    if (point) return {x: point.x, y: -point.y, z: point.z};
    const player = this.options.playerPosition();
    if (!player) return undefined;
    const fallback = new THREE.Vector3();
    const ground = new THREE.Plane(
      new THREE.Vector3(0, 0, 1),
      -this.options.surfaceHeightAt(player.x, player.y)
    );
    return this.raycaster.ray.intersectPlane(ground, fallback)
      ? {x: fallback.x, y: -fallback.y, z: fallback.z}
      : undefined;
  }

  private showCandidate(candidate: BuildingCandidate | undefined): void {
    this.clearCandidatePreview();
    if (!candidate) {
      this.setCandidateLabel('None');
      return;
    }
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const indices: number[] = [];
    for (const cell of candidate.cells) {
      const minX = cell.column * this.options.grid.tileSize;
      const minY = cell.row * this.options.grid.tileSize;
      const maxX = minX + this.options.grid.tileSize;
      const maxY = minY + this.options.grid.tileSize;
      const z = this.options.surfaceHeightAt((minX + maxX) / 2, (minY + maxY) / 2) + 4;
      const offset = positions.length / 3;
      positions.push(
        minX, serverYToScene(minY), z,
        maxX, serverYToScene(minY), z,
        maxX, serverYToScene(maxY), z,
        minX, serverYToScene(maxY), z
      );
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const authored = authoredBuilding(candidate, this.options.authoredBuildings);
    const material = new THREE.MeshBasicMaterial({
      color: authored ? 0xf3c84b : candidate.valid ? 0x43d9ff : 0xff4e4e,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4
    });
    this.targetMesh = new THREE.Mesh(geometry, material);
    this.targetMesh.name = `builder-target:${candidate.id}`;
    this.targetMesh.renderOrder = 90;
    this.root.add(this.targetMesh);
    this.facadeLines = facadeLineMesh(candidate.facades, candidate.roofZ * this.options.grid.tileSize + 8);
    this.root.add(this.facadeLines);
    this.setCandidateLabel(
      authored ? `Authored · ${authored.label}` : candidate.valid ? `${candidate.cells.length} tiles` : 'Invalid structure'
    );
  }

  private showDraft(draft: BuildingAuthorDraft, facade: BuildingFacadeEdge): void {
    this.clearDraftPreview();
    const entrance = draft.building.entrance;
    const entranceWidth = entrance.width * this.options.grid.tileSize;
    const horizontal = entrance.side === 'north' || entrance.side === 'south';
    const z = this.selected ? this.selected.roofZ * this.options.grid.tileSize + 11 : 11;
    this.entranceMesh = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? entranceWidth : 12, horizontal ? 12 : entranceWidth, 7),
      new THREE.MeshBasicMaterial({color: 0xf3c84b, depthTest: false})
    );
    this.entranceMesh.position.set(
      entrance.x * this.options.grid.tileSize,
      serverYToScene(entrance.y * this.options.grid.tileSize),
      z
    );
    this.entranceMesh.renderOrder = 94;
    this.root.add(this.entranceMesh);

    this.fixtureGroup = new THREE.Group();
    this.fixtureGroup.name = 'builder-fixture-preview';
    for (const obstacle of draft.building.obstacles) {
      const width = (obstacle.bounds.maxX - obstacle.bounds.minX) * this.options.grid.tileSize;
      const depth = (obstacle.bounds.maxY - obstacle.bounds.minY) * this.options.grid.tileSize;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, depth, 10),
        new THREE.MeshBasicMaterial({color: Number.parseInt(obstacle.color.slice(1), 16), transparent: true, opacity: 0.82, depthTest: false})
      );
      mesh.position.set(
        (obstacle.bounds.minX + obstacle.bounds.maxX) * this.options.grid.tileSize / 2,
        serverYToScene((obstacle.bounds.minY + obstacle.bounds.maxY) * this.options.grid.tileSize / 2),
        z + 7
      );
      mesh.renderOrder = 93;
      this.fixtureGroup.add(mesh);
    }
    this.root.add(this.fixtureGroup);
    const facadeLength = Math.round(facade.length);
    this.setCandidateLabel(`${draft.building.kind} · ${draft.building.entrance.width * 64}px door · ${facadeLength}px facade`);
  }

  private clearCandidatePreview(): void {
    if (this.targetMesh) disposeAndRemove(this.targetMesh);
    if (this.facadeLines) disposeAndRemove(this.facadeLines);
    this.targetMesh = undefined;
    this.facadeLines = undefined;
  }

  private clearDraftPreview(): void {
    if (this.entranceMesh) disposeAndRemove(this.entranceMesh);
    if (this.fixtureGroup) {
      this.fixtureGroup.removeFromParent();
      this.fixtureGroup.traverse(disposeObject);
    }
    this.entranceMesh = undefined;
    this.fixtureGroup = undefined;
  }

  private persistDraft(draft: BuildingAuthorDraft): void {
    const stored = readStoredDrafts();
    const drafts = stored.drafts.filter((candidate) => candidate.candidateId !== draft.candidateId);
    drafts.push(draft);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version: 1, drafts} satisfies StoredBuildingDrafts));
  }

  private setStatus(message: string): void {
    const status = this.panel.querySelector<HTMLOutputElement>('[data-builder-status]');
    if (status) status.textContent = message;
  }

  private setCandidateLabel(message: string): void {
    const label = this.panel.querySelector('[data-builder-candidate]');
    if (label) label.textContent = message;
  }

  private setTemplateButtonsEnabled(enabled: boolean): void {
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-builder-template]')) {
      button.disabled = !enabled;
    }
  }

  private setResetEnabled(enabled: boolean): void {
    const button = this.panel.querySelector<HTMLButtonElement>('[data-builder-action="reset"]');
    if (button) button.disabled = !enabled;
  }

  private setPublishEnabled(enabled: boolean): void {
    const button = this.panel.querySelector<HTMLButtonElement>('[data-builder-action="publish"]');
    if (button) button.disabled = !enabled;
  }
}

function facadeLineMesh(edges: readonly BuildingFacadeEdge[], z: number): THREE.LineSegments {
  const positions: number[] = [];
  for (const edge of edges) {
    if (edge.side === 'north' || edge.side === 'south') {
      positions.push(edge.start, serverYToScene(edge.fixed), z, edge.end, serverYToScene(edge.fixed), z);
    } else {
      positions.push(edge.fixed, serverYToScene(edge.start), z, edge.fixed, serverYToScene(edge.end), z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({color: 0xf4f7f7, transparent: true, opacity: 0.92, depthTest: false})
  );
  lines.renderOrder = 92;
  return lines;
}

function authoredBuilding(
  candidate: BuildingCandidate,
  buildings?: readonly SeamlessInteriorDefinition[]
): {id: string; label: string} | undefined {
  return authoredBuildingOverlapping(candidate, buildings ?? SEAMLESS_INTERIORS);
}

function readStoredDrafts(): StoredBuildingDrafts {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as StoredBuildingDrafts;
    if (value.version === 1 && Array.isArray(value.drafts)) return value;
  } catch {
    // Invalid local drafts are replaced by the next valid authoring operation.
  }
  return {version: 1, drafts: []};
}

function removeStoredDraft(candidateId: string): void {
  const stored = readStoredDrafts();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    drafts: stored.drafts.filter((draft) => draft.candidateId !== candidateId)
  } satisfies StoredBuildingDrafts));
}

function readStoredAuthorization(): string | undefined {
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function promptForAuthorization(): string | undefined {
  const user = window.prompt('Author username');
  if (!user) return undefined;
  const password = window.prompt('Author password');
  if (password === null) return undefined;
  return `Basic ${btoa(`${user}:${password}`)}`;
}

function postBuildingDraft(draft: BuildingAuthorDraft, authorization?: string): Promise<Response> {
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  if (authorization) headers.Authorization = authorization;
  return fetch('/api/editor/buildings/bil', {
    method: 'POST',
    headers,
    body: JSON.stringify(draft)
  });
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text ? {error: text} : {};
  }
}

function disposeAndRemove(object: THREE.Mesh | THREE.LineSegments): void {
  object.removeFromParent();
  disposeObject(object);
}

function disposeObject(object: THREE.Object3D): void {
  if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments)) return;
  object.geometry.dispose();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) material.dispose();
}

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

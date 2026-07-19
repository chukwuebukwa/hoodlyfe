import * as THREE from 'three';
import {VEHICLE_INPUT_MESSAGE} from '../../../shared/protocol/vehicle-input.ts';
import {ON_FOOT_INPUT_MESSAGE} from '../../../shared/protocol/on-foot-input.ts';
import type {Room} from 'colyseus.js';
import type {DistrictNetworkState} from '../types.ts';
import {ThreeDistrictEntities} from './three-district-entities.ts';
import {ThreeDistrictUiController} from './three-district-ui-controller.ts';
import {ThreeDistrictWorld} from './three-district-world.ts';
import {ThreeDebugController} from './three-debug-controller.ts';
import {ThreeInteriorRenderer} from './three-interior-renderer.ts';
import {ThreeQaDriver} from './three-qa-driver.ts';
import {ThreeInputController} from './three-input-controller.ts';
import {ThreeDayNightController} from './three-day-night-controller.ts';
import {NetworkQualityController} from '../network/network-quality-controller.ts';
import {CombatFirePredictionController} from '../network/combat-fire-prediction-controller.ts';
import {InteractionIslandController} from '../network/interaction-island-controller.ts';
import type {InteractionSnapshotInbox} from '../network/interaction-snapshot-inbox.ts';
import type {NetcodeRolloutController} from '../network/netcode-rollout-controller.ts';
import type {NockPhoneController} from '../ui/nock-phone-controller.ts';
import {ClientCollisionMap} from '../world/client-collision-map.ts';
import {STREET_SPACE_ID, interiorDefinition} from '../../../shared/content/interior-catalog.ts';
import {WORLD_COLLISION_REVISION} from '../../../shared/simulation/world-collision-revision.ts';
import {
  createMixedInteractionBodyStep,
  createMixedInteractionPairStep
} from '../prediction/mixed-interaction-replay.ts';
import {
  perspectiveHeightForSpan,
  serverYToThree
} from './three-prototype-policy.ts';
import {ThreeMapChunkStreamer} from './three-map-chunk-streamer.ts';
import type {ThreeMapManifest, ThreeMapOccluderDefinition} from './three-map-format.ts';

interface MapMetadataPayload {
  spawn: {x: number; y: number};
}

const FIELD_OF_VIEW = 45;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.8;
export class ThreePrototypeViewer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 20_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private frame = 0;
  private zoom = 1.65;
  private baseHeight = 1;
  private center = new THREE.Vector3();
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private status?: HTMLElement;
  private entities?: ThreeDistrictEntities;
  private input?: ThreeInputController;
  private ui?: ThreeDistrictUiController;
  private world?: ThreeDistrictWorld;
  private debug?: ThreeDebugController;
  private networkQuality?: NetworkQualityController;
  private combatFirePrediction?: CombatFirePredictionController;
  private interactionIslands?: InteractionIslandController;
  private interiors?: ThreeInteriorRenderer;
  private lighting?: ThreeDayNightController;
  private readonly mapOccluders = new Map<string, THREE.Group>();
  private mapStreamer?: ThreeMapChunkStreamer;
  private qa?: ThreeQaDriver;
  private payload?: ThreeMapManifest;
  private centerInitialized = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly room?: Room<DistrictNetworkState>,
    private readonly interactionSnapshots?: InteractionSnapshotInbox,
    private readonly netcodeRollout?: NetcodeRolloutController,
    private readonly phone?: NockPhoneController
  ) {
    this.renderer = new THREE.WebGLRenderer({antialias: false, alpha: false, powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.id = 'three-prototype-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'GTA2 three-dimensional map prototype');
    this.parent.replaceChildren(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x090b0c);
    this.camera.up.set(0, 1, 0);
  }

  async start(): Promise<void> {
    const [mapStreamer, metadata, collision] = await Promise.all([
      ThreeMapChunkStreamer.create(this.scene, this.mapOccluders),
      loadMapMetadata('/assets/maps/district-map.metadata.json'),
      ClientCollisionMap.load()
    ]);
    this.mapStreamer = mapStreamer;
    const payload = mapStreamer.manifest;
    this.payload = payload;
    for (const occluder of payload.occluders) validateOccluder(occluder, payload.blockSize);
    this.baseHeight = perspectiveHeightForSpan(900, FIELD_OF_VIEW);
    this.resize();
    this.frameSpectatorSpawn(metadata.spawn.x, metadata.spawn.y);
    const initialView = this.mapStreamingView();
    await mapStreamer.prime(
      metadata.spawn.x,
      metadata.spawn.y,
      initialView.halfWidth,
      initialView.halfHeight
    );
    this.lighting = await ThreeDayNightController.create(this.scene, this.surfaceHeightAt);
    if (this.room) {
      this.interiors = new ThreeInteriorRenderer(this.scene);
      this.entities = await ThreeDistrictEntities.create(
        this.scene,
        this.surfaceHeightAt,
        (spaceId, x, y, radius) => collision.canOccupy(spaceId, x, y, radius),
        (sample) => this.networkQuality?.observeRemoteTimeline(sample),
        () => this.rolloutEnabled('remoteTimelines'),
        (playerId) => this.ui?.playerVoiceActivity(playerId) ?? 0
      );
      this.world = await ThreeDistrictWorld.create(
        this.scene,
        this.room.sessionId,
        this.surfaceHeightAt
      );
      this.networkQuality = new NetworkQualityController(this.room);
      this.combatFirePrediction = new CombatFirePredictionController({
        room: this.room,
        getPlayer: () => this.room?.state.players.get(this.room.sessionId),
        getAimOrigin: () => this.entities?.playerAimOrigin(this.room?.sessionId ?? ''),
        estimatedServerTimeMs: () => {
          const quality = this.networkQuality?.snapshot();
          return quality?.clockSynchronized
            ? quality.estimatedServerTimeMs
            : this.room?.state.serverTimeMs ?? 0;
        },
        canOccupy: (x, y, radius) => collision.canOccupy(STREET_SPACE_ID, x, y, radius),
        combatRewindEnabled: () => this.rolloutEnabled('combatRewind'),
        projectilePredictionEnabled: () => this.rolloutEnabled('projectilePrediction')
      });
      if (this.interactionSnapshots) {
        const canOccupyInteraction = (
          spaceId: string,
          x: number,
          y: number,
          radius: number
        ) => collision.canOccupy(spaceId, x, y, radius);
        this.interactionIslands = new InteractionIslandController(this.interactionSnapshots, {
          enabled: () => this.rolloutEnabled('interactionReplay'),
          networkConditions: () => {
            const network = this.networkQuality?.snapshot();
            return {
              rttMs: network?.rttP95Ms ?? 0,
              interpolationDelayMs: network?.interpolationDelayMs ?? 75,
              jitterMs: network?.jitterMs ?? 0
            };
          },
          onHistory: (frames) => this.networkQuality?.observeInteractionHistory(frames),
          onSelection: (selection) => this.networkQuality?.observeInteractionIsland(selection),
          replay: {
            prepare: (baseline) => this.entities?.prepareInteractionReplay(baseline),
            worldCollisionRevision: () => WORLD_COLLISION_REVISION,
            stepBody: createMixedInteractionBodyStep(canOccupyInteraction),
            resolvePair: createMixedInteractionPairStep(canOccupyInteraction),
            onReplay: (result, durationMs, baseline) => {
              this.entities?.applyInteractionReplay(baseline, result);
              this.networkQuality?.observeInteractionReplay(result, durationMs);
            }
          }
        });
      }
      this.debug = new ThreeDebugController(
        this.scene,
        this.room,
        this.surfaceHeightAt,
        () => this.networkQuality?.snapshot(),
        (vehicleId) => this.entities?.vehiclePose(vehicleId),
        (playerId) => this.entities?.playerPose(playerId),
        () => this.interactionIslands?.latest(),
        () => this.netcodeRollout?.snapshot(),
        () => this.mapStreamer?.snapshot()
      );
      if (isDevelopment() && new URLSearchParams(window.location.search).get('qa') === '1') {
        this.qa = new ThreeQaDriver(this.room);
      }
      this.ui = new ThreeDistrictUiController(
        this.room,
        payload.surfaces.width * payload.blockSize,
        payload.surfaces.height * payload.blockSize,
        () => this.entities?.playerPose(this.room?.sessionId ?? ''),
        this.phone
      );
      this.input = new ThreeInputController({
        room: this.room,
        canvas: this.renderer.domElement,
        camera: this.camera,
        player: () => this.room?.state.players.get(this.room.sessionId),
        vehicleAngle: (vehicleId) => (
          this.entities?.vehiclePose(vehicleId)?.angle ??
          this.room?.state.vehicles.get(vehicleId)?.angle
        ),
        surfaceZ: () => this.center.z,
        onFire: (angle) => this.combatFirePrediction?.requestFire(angle),
        isBlocked: () => this.ui?.isInputBlocked() ?? false
      });
      this.followLocalPlayer();
    }
    this.createStatus(payload);
    this.bind();
    this.resize();
    this.frame = requestAnimationFrame(this.render);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.unbind();
    this.input?.destroy();
    this.ui?.destroy();
    this.entities?.destroy();
    this.world?.destroy();
    this.debug?.destroy();
    this.interactionIslands?.destroy();
    this.networkQuality?.destroy();
    this.combatFirePrediction?.destroy();
    this.interiors?.destroy();
    this.lighting?.destroy();
    this.qa?.destroy();
    this.mapStreamer?.destroy();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
        material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.status?.remove();
  }

  private rolloutEnabled(stage: Parameters<NetcodeRolloutController['enabled']>[0]): boolean {
    return this.netcodeRollout?.enabled(stage) ?? true;
  }

  private applyCamera(): void {
    this.camera.position.set(
      this.center.x,
      this.center.y,
      this.center.z + this.baseHeight / this.zoom
    );
    this.camera.lookAt(this.center.x, this.center.y, this.center.z);
  }

  private createStatus(payload: ThreeMapManifest): void {
    const status = document.createElement('aside');
    status.id = 'three-prototype-status';
    const roofTriangles = [...this.mapOccluders.values()]
      .reduce((sum, occluder) => sum + Number(occluder.userData.triangleCount ?? 0), 0);
    status.innerHTML = `<strong>3D STREAMING</strong><span>WORLD ${payload.size.width}x${payload.size.height}</span>` +
      `<i id="three-map-stream-status">0/${payload.chunks.length} CHUNKS / ` +
      `${payload.triangleCount.toLocaleString()} TRIANGLES / ${roofTriangles} AUTHORED ROOF</i>` +
      `<b id="world-clock-status">08:00 DAY</b>`;
    document.querySelector('#game-shell')?.append(status);
    this.status = status;
  }

  private readonly render = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.room) {
      const now = performance.now();
      const quality = this.networkQuality?.snapshot();
      const renderServerTime = quality
        ? quality.estimatedServerTimeMs - quality.interpolationDelayMs
        : this.room.state.serverTimeMs ?? 0;
      const localSpaceId = this.interiors?.synchronize(this.room.state, this.room.sessionId) ?? 'street';
      for (const [id, occluder] of this.mapOccluders) occluder.visible = id !== localSpaceId;
      this.entities?.synchronize(
        this.room.state,
        localSpaceId,
        this.room.sessionId,
        renderServerTime,
        quality?.estimatedServerTimeMs ?? this.room.state.serverTimeMs ?? renderServerTime
      );
      this.combatFirePrediction?.synchronizeAuthoritative(this.room.state.bullets);
      this.world?.synchronize(this.room.state, now, localSpaceId);
      const movement = this.input?.update(now) ?? {x: 0, y: 0};
      this.world?.synchronizePredictedBullets(
        this.combatFirePrediction?.update(now) ?? [],
        localSpaceId
      );
      const local = this.room.state.players.get(this.room.sessionId);
      const localVehicle = local?.vehicleId
        ? this.room.state.vehicles.get(local.vehicleId)
        : undefined;
      if (local && !localVehicle) {
        const prediction = this.entities?.predictLocalPlayer(
          this.room.sessionId,
          movement,
          delta
        );
        if (prediction?.outboundMoves.length) {
          this.room.send(ON_FOOT_INPUT_MESSAGE, {moves: prediction.outboundMoves});
        }
        if (prediction?.correction) {
          this.networkQuality?.observeOnFootPrediction(
            prediction.correction.positionError,
            prediction.correction.hardCorrection,
            prediction.correction.pendingMoveCount,
            local.lastInputSequence ?? 0,
            prediction.correction.resimulated
          );
        }
      }
      if (local?.vehicleId && local.vehicleSeat === 0 && localVehicle) {
        const prediction = this.entities?.predictLocalVehicle(local.vehicleId, movement, delta);
        if (prediction?.outboundMoves.length) {
          this.room.send(VEHICLE_INPUT_MESSAGE, {
            vehicleId: local.vehicleId,
            moves: prediction.outboundMoves
          });
        }
        if (prediction?.correction) {
          this.networkQuality?.observePrediction(
            prediction.correction.positionError,
            prediction.correction.hardCorrection,
            prediction.correction.pendingMoveCount,
            local.lastVehicleInputSequence ?? 0,
            prediction.correction.resimulated
          );
        }
      }
      this.networkQuality?.update(now);
      this.debug?.update(this.room.state, now);
      this.qa?.update();
      this.ui?.update(this.room.state, now);
      this.followLocalPlayer();
      const vehiclePose = local?.vehicleId ? this.entities?.vehiclePose(local.vehicleId) : undefined;
      const playerPose = local ? this.entities?.playerPose(this.room.sessionId) : undefined;
      const focusX = vehiclePose?.x ?? localVehicle?.x ?? playerPose?.x ?? local?.x ?? this.center.x;
      const focusY = vehiclePose?.y ?? localVehicle?.y ?? playerPose?.y ?? local?.y ?? serverYToThree(this.center.y);
      const mapView = this.mapStreamingView();
      this.mapStreamer?.update(focusX, focusY, mapView.halfWidth, mapView.halfHeight, now);
      const nightIntensity = this.lighting?.update({
        worldTimeStartedAt: this.room.state.worldTimeStartedAt ?? Date.now(),
        worldTimeStartMinute: this.room.state.worldTimeStartMinute ?? 8 * 60,
        worldTimeRate: this.room.state.worldTimeRate ?? 0
      }, Date.now(), focusX, focusY, localSpaceId, this.status?.querySelector('#world-clock-status') ?? undefined) ?? 0;
      this.entities?.updateVehicleLights(nightIntensity, focusX, focusY);
    } else {
      const pan = 260 * delta / this.zoom;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.center.x -= pan;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.center.x += pan;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.center.y -= pan;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.center.y += pan;
      const mapView = this.mapStreamingView();
      this.mapStreamer?.update(
        this.center.x,
        serverYToThree(this.center.y),
        mapView.halfWidth,
        mapView.halfHeight
      );
    }
    this.updateMapStreamingStatus();
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.render);
  };

  private readonly resize = (): void => {
    const width = Math.max(1, this.parent.clientWidth);
    const height = Math.max(1, this.parent.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.room) return;
    event.preventDefault();
    this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.room) return;
    this.dragging = true;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.room) return;
    if (!this.dragging) return;
    const scale = this.baseHeight / this.zoom / Math.max(1, this.parent.clientHeight);
    this.center.x -= (event.clientX - this.pointerX) * scale;
    this.center.y -= (event.clientY - this.pointerY) * scale;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.room) return;
    this.dragging = false;
    this.renderer.domElement.releasePointerCapture(event.pointerId);
  };

  private readonly surfaceHeightAt = (x: number, y: number): number => {
    const interiorHeight = this.interiors?.surfaceHeightAt(x, y);
    if (interiorHeight !== undefined) return interiorHeight;
    const payload = this.payload;
    if (!payload) return 0;
    const column = Math.max(0, Math.min(payload.surfaces.width - 1, Math.floor(x / payload.blockSize)));
    const row = Math.max(0, Math.min(payload.surfaces.height - 1, Math.floor(y / payload.blockSize)));
    return payload.surfaces.values[row * payload.surfaces.width + column] * payload.blockSize;
  };

  private mapStreamingView(): {halfWidth: number; halfHeight: number} {
    const cameraDistance = this.baseHeight / this.zoom;
    const halfHeight = cameraDistance * Math.tan(FIELD_OF_VIEW * Math.PI / 360);
    return {
      halfWidth: halfHeight * Math.max(0.5, this.camera.aspect),
      halfHeight
    };
  }

  private updateMapStreamingStatus(): void {
    const snapshot = this.mapStreamer?.snapshot();
    const element = this.status?.querySelector('#three-map-stream-status');
    if (!snapshot || !element) return;
    const value = `${snapshot.loaded}/${snapshot.totalChunks} CHUNKS / ` +
      `${snapshot.loading} LOADING / ${snapshot.queued} QUEUED / ` +
      `${snapshot.loadedTriangles.toLocaleString()} TRIANGLES`;
    if (element.textContent !== value) element.textContent = value;
  }

  private followLocalPlayer(): void {
    const room = this.room;
    if (!room) return;
    const player = room.state.players.get(room.sessionId);
    if (!player) return;
    const vehicle = player.vehicleId ? room.state.vehicles.get(player.vehicleId) : undefined;
    const vehiclePose = player.vehicleId ? this.entities?.vehiclePose(player.vehicleId) : undefined;
    const playerPose = this.entities?.playerPose(room.sessionId);
    const x = vehiclePose?.x ?? vehicle?.x ?? playerPose?.x ?? player.x;
    const y = vehiclePose?.y ?? vehicle?.y ?? playerPose?.y ?? player.y;
    this.renderer.domElement.dataset.localX = x.toFixed(2);
    this.renderer.domElement.dataset.localY = y.toFixed(2);
    this.renderer.domElement.dataset.localMode = vehicle ? 'vehicle' : 'foot';
    const target = new THREE.Vector3(x, serverYToThree(y), this.surfaceHeightAt(x, y));
    if (!this.centerInitialized || this.center.distanceTo(target) > 700) {
      this.center.copy(target);
      this.centerInitialized = true;
    } else {
      this.center.lerp(target, 0.2);
    }
  }

  private frameSpectatorSpawn(x: number, y: number): void {
    if (this.centerInitialized || this.room?.state.players.get(this.room.sessionId)) return;
    this.center.set(x, serverYToThree(y), this.surfaceHeightAt(x, y));
    this.centerInitialized = true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };
  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private bind(): void {
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.addEventListener('wheel', this.handleWheel, {passive: false});
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerUp);
  }

  private unbind(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.removeEventListener('wheel', this.handleWheel);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerUp);
  }
}

function isDevelopment(): boolean {
  const metaEnv = (import.meta as unknown as {env?: {DEV?: boolean}}).env;
  return metaEnv?.DEV ?? process.env.NODE_ENV !== 'production';
}

function validateOccluder(occluder: ThreeMapOccluderDefinition, blockSize: number): void {
  const expected = interiorDefinition(occluder.id);
  if (!expected) return;
  const doorX = occluder.exteriorDoor.x * blockSize;
  const doorY = occluder.exteriorDoor.y * blockSize;
  const floorZ = occluder.floorZ * blockSize;
  if (
    Math.abs(doorX - expected.exteriorDoor.x) > 1 ||
    Math.abs(doorY - expected.exteriorDoor.y) > 1 ||
    Math.abs(floorZ - expected.floorZ) > 1
  ) {
    throw new Error(`Authored occluder metadata does not match interior: ${occluder.id}`);
  }
  if (!Number.isInteger(occluder.triangleCount) || occluder.triangleCount <= 0) {
    throw new Error(`Authored occluder triangle count is invalid: ${occluder.id}`);
  }
}

async function loadMapMetadata(url: string): Promise<MapMetadataPayload> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`District metadata failed to load (${response.status}).`);
  return response.json() as Promise<MapMetadataPayload>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

import * as THREE from 'three';
import {
  PROJECTILE_IMPACTS_MESSAGE,
  type ProjectileImpactsMessage
} from '../../shared/protocol/projectile-impacts.ts';
import type {Room} from 'colyseus.js';
import type {DistrictNetworkState, NetworkPlayer} from './types.ts';
import {ActorPresentation} from './presentation/actors.ts';
import {DistrictUiController} from './ui/district-ui-controller.ts';
import {WorldObjectPresentation} from './presentation/objects.ts';
import {DebugController} from './debug/debug-controller.ts';
import {InteriorPresentation} from './presentation/interiors.ts';
import {QaDriver} from './qa/driver.ts';
import {InputController} from './input/input-controller.ts';
import {LightingPresentation} from './presentation/lighting.ts';
import {NetworkQualityController} from './network/network-quality-controller.ts';
import type {NetcodeRolloutController} from './network/netcode-rollout-controller.ts';
import type {NockPhoneController} from './ui/nock-phone-controller.ts';
import {CombatFireCommandSender} from './network/combat-fire-command-sender.ts';
import {interiorDefinition} from '../../shared/content/interior-catalog.ts';
import {isWeaponId} from '../../shared/content/weapon-catalog.ts';
import {STREET_GROUND_SURFACE_ID, SurfaceMap} from '../../shared/world/surface-map.ts';
import {
  mapSurfaceHeightAt,
  perspectiveHeightForSpan,
  renderedSurfaceHeight,
  serverYToScene
} from './presentation/scene-policy.ts';
import {MapChunkStreamer} from './presentation/map/chunk-streamer.ts';
import type {
  WorldGeometryManifest,
  WorldGeometryOccluderDefinition
} from './presentation/map/geometry-format.ts';
import {
  cameraRecoilOffset,
  explorerCameraPose,
  type CameraFollowMode,
  type CameraPresentationMode
} from './camera/camera-policy.ts';
import {gunshotPresentation} from './rendering/player-render-policy.ts';

interface MapMetadataPayload {
  spawn: {x: number; y: number};
}

const FIELD_OF_VIEW = 45;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.8;
const CAMERA_MODE_STORAGE_KEY = 'nock0.camera-mode';
const EXPLORER_STREAMING_HALF_EXTENT = 2_048;
const EXPLORER_MOUSE_YAW_SPEED = 0.0025;
const EXPLORER_MOUSE_PITCH_SPEED = 0.002;
const EXPLORER_MIN_PITCH = -0.72;
const EXPLORER_MAX_PITCH = 0.52;
export class DistrictClient {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 20_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private lastAuthorityInputAt = Number.NEGATIVE_INFINITY;
  private lastAuthorityInput = {x: Number.NaN, y: Number.NaN, handbrake: false};
  private frame = 0;
  private zoom = 1.65;
  private baseHeight = 1;
  private center = new THREE.Vector3();
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private status?: HTMLElement;
  private actors?: ActorPresentation;
  private input?: InputController;
  private ui?: DistrictUiController;
  private objects?: WorldObjectPresentation;
  private debug?: DebugController;
  private networkQuality?: NetworkQualityController;
  private combatFire?: CombatFireCommandSender;
  private removeProjectileImpacts?: () => void;
  private interiors?: InteriorPresentation;
  private lighting?: LightingPresentation;
  private readonly mapOccluders = new Map<string, THREE.Group>();
  private mapStreamer?: MapChunkStreamer;
  private qa?: QaDriver;
  private payload?: WorldGeometryManifest;
  private surfaceMap?: SurfaceMap;
  private centerInitialized = false;
  private cameraMode: CameraPresentationMode = readCameraMode();
  private settingsOpen = false;
  private explorerYaw?: number;
  private explorerPitch = -0.08;
  private cameraShotSequence?: number;
  private cameraShotStartedAt?: number;
  private cameraShotWeapon?: NetworkPlayer['weapon'];
  private cameraShotAngle = 0;
  private cameraShotPassenger = false;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly settingsToggle = document.querySelector<HTMLButtonElement>('#settings-toggle');
  private readonly settingsOverlay = document.querySelector<HTMLElement>('#settings-overlay');
  private readonly settingsClose = document.querySelector<HTMLButtonElement>('#settings-close');
  private readonly cameraModeToggle = document.querySelector<HTMLInputElement>('#settings-camera-explorer');

  constructor(
    private readonly parent: HTMLElement,
    private readonly room?: Room<DistrictNetworkState>,
    private readonly netcodeRollout?: NetcodeRolloutController,
    private readonly phone?: NockPhoneController
  ) {
    this.renderer = new THREE.WebGLRenderer({antialias: false, alpha: false, powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'District game canvas');
    this.parent.replaceChildren(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x090b0c);
    this.camera.up.set(0, 1, 0);
    this.updateCameraModeToggle();
  }

  async start(): Promise<void> {
    const [mapStreamer, metadata, surfaceMap] = await Promise.all([
      MapChunkStreamer.create(this.scene, this.mapOccluders),
      loadMapMetadata('/assets/maps/district-map.metadata.json'),
      loadSurfaceMap('/assets/maps/surface-manifest.json')
    ]);
    this.mapStreamer = mapStreamer;
    this.surfaceMap = surfaceMap;
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
    this.lighting = await LightingPresentation.create(this.scene, this.surfaceHeightAt);
    if (this.room) {
      this.interiors = new InteriorPresentation(this.scene);
      this.actors = await ActorPresentation.create(
        this.scene,
        this.room.sessionId,
        this.surfaceHeightAt,
        (sample) => this.networkQuality?.observeRemoteTimeline(sample),
        () => this.rolloutEnabled('remoteTimelines'),
        (playerId) => this.ui?.playerVoiceActivity(playerId) ?? 0
      );
      this.objects = await WorldObjectPresentation.create(
        this.scene,
        this.room.sessionId,
        this.surfaceHeightAt
      );
      const removeProjectileImpacts = this.room.onMessage<ProjectileImpactsMessage>(
        PROJECTILE_IMPACTS_MESSAGE,
        (message) => this.objects?.presentProjectileImpacts(message.impacts, performance.now())
      );
      this.removeProjectileImpacts = typeof removeProjectileImpacts === 'function'
        ? removeProjectileImpacts
        : undefined;
      this.networkQuality = new NetworkQualityController(this.room);
      this.combatFire = new CombatFireCommandSender({
        room: this.room,
        player: () => this.room?.state.players.get(this.room.sessionId),
        estimatedServerTimeMs: () => {
          const quality = this.networkQuality?.snapshot();
          return quality?.clockSynchronized
            ? quality.estimatedServerTimeMs
            : this.room?.state.serverTimeMs ?? 0;
        },
        combatRewindEnabled: () => this.rolloutEnabled('combatRewind'),
        onReceipt: (receipt, aimAngle) => {
          if (!receipt.accepted && receipt.reason === 'empty-magazine') this.ui?.presentDryFire();
          const player = this.room?.state.players.get(this.room.sessionId);
          if (
            receipt.accepted &&
            receipt.shotSequence !== undefined &&
            receipt.weapon &&
            isWeaponId(receipt.weapon) &&
            aimAngle !== undefined
          ) {
            this.presentCameraShot(receipt.shotSequence, receipt.weapon, aimAngle, player, performance.now());
          }
        }
      });
      this.debug = new DebugController(
        this.scene,
        this.room,
        this.surfaceHeightAt,
        () => this.networkQuality?.snapshot(),
        () => this.netcodeRollout?.snapshot(),
        () => this.mapStreamer?.snapshot(),
        (vehicleId) => this.actors?.vehiclePose(vehicleId)
      );
      if (isDevelopment() && new URLSearchParams(window.location.search).get('qa') === '1') {
        this.qa = new QaDriver(this.room);
      }
      this.ui = new DistrictUiController(
        this.room,
        payload.surfaces.width * payload.blockSize,
        payload.surfaces.height * payload.blockSize,
        () => this.actors?.playerPose(this.room?.sessionId ?? ''),
        this.phone
      );
      this.input = new InputController({
        room: this.room,
        canvas: this.renderer.domElement,
        camera: this.camera,
        player: () => this.room?.state.players.get(this.room.sessionId),
        aimOrigin: () => this.actors?.playerAimOrigin(this.room?.sessionId ?? ''),
        vehicleAngle: (vehicleId) => (
          this.actors?.vehiclePose(vehicleId)?.angle ??
          this.room?.state.vehicles.get(vehicleId)?.angle
        ),
        surfaceZ: () => this.center.z,
        isBlocked: () => this.settingsOpen || (this.ui?.isInputBlocked() ?? false),
        onFire: (angle) => {
          this.combatFire?.send(angle);
        },
        directAimAngle: () => this.cameraMode === 'explorer' ? this.explorerYaw : undefined
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
    this.combatFire?.destroy();
    this.removeProjectileImpacts?.();
    this.ui?.destroy();
    this.actors?.destroy();
    this.objects?.destroy();
    this.debug?.destroy();
    this.networkQuality?.destroy();
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

  private applyCamera(nowMs: number): void {
    const focus = this.localCameraFocus();
    const recoil = this.cameraRecoil(nowMs);
    if (this.cameraMode === 'explorer' && focus) {
      this.camera.up.set(0, 0, 1);
      this.explorerYaw ??= focus.angle;
      const pose = explorerCameraPose(
        focus.x,
        serverYToScene(focus.y),
        this.surfaceHeightAt(focus.x, focus.y),
        this.explorerYaw,
        focus.mode,
        this.explorerPitch + recoil.pitch
      );
      this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
      return;
    }
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(
      this.center.x + recoil.x,
      this.center.y + recoil.y,
      this.center.z + this.baseHeight / this.zoom
    );
    this.camera.lookAt(
      this.center.x + recoil.x,
      this.center.y + recoil.y,
      this.center.z
    );
  }

  private observeLocalShot(player: NetworkPlayer | undefined, nowMs: number): void {
    if (!player) {
      this.cameraShotSequence = undefined;
      this.cameraShotStartedAt = undefined;
      return;
    }
    const sequence = player.shotSequence ?? 0;
    const previous = this.cameraShotSequence;
    if (!player.alive) {
      this.cameraShotStartedAt = undefined;
      if (previous === undefined || sequence > previous) this.cameraShotSequence = sequence;
      return;
    }
    if (previous === undefined) {
      this.cameraShotSequence = sequence;
      return;
    }
    if (sequence <= previous) return;
    this.presentCameraShot(sequence, player.weapon, player.angle, player, nowMs);
  }

  private presentCameraShot(
    sequence: number,
    weapon: NetworkPlayer['weapon'],
    angle: number,
    player: NetworkPlayer | undefined,
    nowMs: number
  ): void {
    if (!player?.alive || (this.cameraShotSequence !== undefined && sequence <= this.cameraShotSequence)) {
      return;
    }
    this.cameraShotSequence = sequence;
    this.cameraShotStartedAt = nowMs;
    this.cameraShotWeapon = weapon;
    this.cameraShotAngle = angle;
    this.cameraShotPassenger = Boolean(player.vehicleId && player.vehicleSeat > 0);
  }

  private cameraRecoil(nowMs: number): {x: number; y: number; pitch: number} {
    const shot = this.cameraShotWeapon && this.cameraShotStartedAt !== undefined
      ? gunshotPresentation(this.cameraShotWeapon, nowMs - this.cameraShotStartedAt)
      : undefined;
    return cameraRecoilOffset(
      shot?.kickDistance ?? 0,
      this.cameraShotAngle,
      this.cameraMode,
      this.cameraShotPassenger,
      this.reducedMotion.matches
    );
  }

  private createStatus(payload: WorldGeometryManifest): void {
    const status = document.createElement('aside');
    status.id = 'game-status';
    const roofTriangles = [...this.mapOccluders.values()]
      .reduce((sum, occluder) => sum + Number(occluder.userData.triangleCount ?? 0), 0);
    status.innerHTML = `<strong>3D STREAMING</strong><span>WORLD ${payload.size.width}x${payload.size.height}</span>` +
      `<i id="map-stream-status">0/${payload.chunks.length} CHUNKS / ` +
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
      this.actors?.synchronize(
        this.room.state,
        localSpaceId,
        renderServerTime,
        quality?.estimatedServerTimeMs ?? this.room.state.serverTimeMs ?? renderServerTime
      );
      this.objects?.synchronize(this.room.state, now, localSpaceId);
      const movement = this.input?.update(now) ?? {x: 0, y: 0, handbrake: false};
      const local = this.room.state.players.get(this.room.sessionId);
      this.observeLocalShot(local, now);
      const localVehicle = local?.vehicleId
        ? this.room.state.vehicles.get(local.vehicleId)
        : undefined;
      if (local?.alive) {
        if (
          now - this.lastAuthorityInputAt >= 50 ||
          movement.x !== this.lastAuthorityInput.x ||
          movement.y !== this.lastAuthorityInput.y ||
          movement.handbrake !== this.lastAuthorityInput.handbrake
        ) {
          this.room.send('input', movement);
          this.lastAuthorityInputAt = now;
          this.lastAuthorityInput = movement;
        }
      }
      this.networkQuality?.update(now);
      this.debug?.update(this.room.state, now);
      this.qa?.update();
      this.ui?.update(this.room.state, now);
      this.followLocalPlayer();
      const vehiclePose = local?.vehicleId ? this.actors?.vehiclePose(local.vehicleId) : undefined;
      const playerPose = local ? this.actors?.playerPose(this.room.sessionId) : undefined;
      const focusX = vehiclePose?.x ?? localVehicle?.x ?? playerPose?.x ?? local?.x ?? this.center.x;
      const focusY = vehiclePose?.y ?? localVehicle?.y ?? playerPose?.y ?? local?.y ?? serverYToScene(this.center.y);
      const mapView = this.mapStreamingView();
      this.mapStreamer?.update(focusX, focusY, mapView.halfWidth, mapView.halfHeight, now);
      const nightIntensity = this.lighting?.update({
        worldTimeStartedAt: this.room.state.worldTimeStartedAt ?? Date.now(),
        worldTimeStartMinute: this.room.state.worldTimeStartMinute ?? 8 * 60,
        worldTimeRate: this.room.state.worldTimeRate ?? 0
      }, Date.now(), focusX, focusY, localSpaceId, this.status?.querySelector('#world-clock-status') ?? undefined) ?? 0;
      this.actors?.updateVehicleLights(nightIntensity, focusX, focusY);
    } else {
      const pan = 260 * delta / this.zoom;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.center.x -= pan;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.center.x += pan;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.center.y -= pan;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.center.y += pan;
      const mapView = this.mapStreamingView();
      this.mapStreamer?.update(
        this.center.x,
        serverYToScene(this.center.y),
        mapView.halfWidth,
        mapView.halfHeight
      );
    }
    this.updateMapStreamingStatus();
    this.applyCamera(performance.now());
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
    if (this.room) {
      if (
        this.cameraMode === 'explorer' &&
        !this.settingsOpen &&
        document.pointerLockElement !== this.renderer.domElement
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.renderer.domElement.requestPointerLock();
      }
      return;
    }
    this.dragging = true;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.room) {
      if (
        this.cameraMode === 'explorer' &&
        !this.settingsOpen &&
        document.pointerLockElement === this.renderer.domElement
      ) {
        this.explorerYaw = normalizeAngle((this.explorerYaw ?? 0) + event.movementX * EXPLORER_MOUSE_YAW_SPEED);
        this.explorerPitch = clamp(
          this.explorerPitch - event.movementY * EXPLORER_MOUSE_PITCH_SPEED,
          EXPLORER_MIN_PITCH,
          EXPLORER_MAX_PITCH
        );
      }
      return;
    }
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

  private readonly surfaceHeightAt = (x: number, y: number, surfaceId?: string): number => {
    if (!surfaceId) {
      const interiorHeight = this.interiors?.surfaceHeightAt(x, y);
      if (interiorHeight !== undefined) return interiorHeight;
    }
    const payload = this.payload;
    if (!payload) return 0;
    const authoredHeight = surfaceId && surfaceId !== STREET_GROUND_SURFACE_ID
      ? this.surfaceMap?.heightAt(surfaceId, x, y)
      : undefined;
    return renderedSurfaceHeight(
      surfaceId,
      authoredHeight,
      mapSurfaceHeightAt(x, y, payload),
      STREET_GROUND_SURFACE_ID
    );
  };

  private mapStreamingView(): {halfWidth: number; halfHeight: number} {
    if (this.cameraMode === 'explorer') {
      return {
        halfWidth: EXPLORER_STREAMING_HALF_EXTENT,
        halfHeight: EXPLORER_STREAMING_HALF_EXTENT
      };
    }
    const cameraDistance = this.baseHeight / this.zoom;
    const halfHeight = cameraDistance * Math.tan(FIELD_OF_VIEW * Math.PI / 360);
    return {
      halfWidth: halfHeight * Math.max(0.5, this.camera.aspect),
      halfHeight
    };
  }

  private updateMapStreamingStatus(): void {
    const snapshot = this.mapStreamer?.snapshot();
    const element = this.status?.querySelector('#map-stream-status');
    if (!snapshot || !element) return;
    const value = `${snapshot.loaded}/${snapshot.totalChunks} CHUNKS / ` +
      `${snapshot.loading} LOADING / ${snapshot.queued} QUEUED / ` +
      `${snapshot.loadedTriangles.toLocaleString()} TRIANGLES`;
    if (element.textContent !== value) element.textContent = value;
  }

  private followLocalPlayer(): void {
    const focus = this.localCameraFocus();
    if (!focus) return;
    const {x, y} = focus;
    this.renderer.domElement.dataset.localX = x.toFixed(2);
    this.renderer.domElement.dataset.localY = y.toFixed(2);
    this.renderer.domElement.dataset.localMode = focus.mode === 'vehicle' ? 'vehicle' : 'foot';
    const target = new THREE.Vector3(x, serverYToScene(y), this.surfaceHeightAt(x, y));
    if (!this.centerInitialized || this.center.distanceTo(target) > 700) {
      this.center.copy(target);
      this.centerInitialized = true;
    } else {
      this.center.lerp(target, 0.2);
    }
  }

  private localCameraFocus(): {x: number; y: number; angle: number; mode: CameraFollowMode} | undefined {
    const room = this.room;
    if (!room) return undefined;
    const player = room.state.players.get(room.sessionId);
    if (!player) return undefined;
    const vehicle = player.vehicleId ? room.state.vehicles.get(player.vehicleId) : undefined;
    const vehiclePose = player.vehicleId ? this.actors?.vehiclePose(player.vehicleId) : undefined;
    const playerPose = this.actors?.playerPose(room.sessionId);
    return {
      x: vehiclePose?.x ?? vehicle?.x ?? playerPose?.x ?? player.x,
      y: vehiclePose?.y ?? vehicle?.y ?? playerPose?.y ?? player.y,
      angle: vehiclePose?.angle ?? vehicle?.angle ?? playerPose?.angle ?? player.angle,
      mode: player.vehicleId ? 'vehicle' : 'player'
    };
  }

  private frameSpectatorSpawn(x: number, y: number): void {
    if (this.centerInitialized || this.room?.state.players.get(this.room.sessionId)) return;
    this.center.set(x, serverYToScene(y), this.surfaceHeightAt(x, y));
    this.centerInitialized = true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && this.settingsOpen) {
      this.setSettingsOpen(false);
      return;
    }
    if (this.settingsOpen) return;
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
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerUp);
    this.settingsToggle?.addEventListener('click', this.handleSettingsToggle);
    this.settingsClose?.addEventListener('click', this.handleSettingsClose);
    this.settingsOverlay?.addEventListener('click', this.handleSettingsBackdrop);
    this.cameraModeToggle?.addEventListener('change', this.handleCameraModeChange);
  }

  private unbind(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.removeEventListener('wheel', this.handleWheel);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerUp);
    this.settingsToggle?.removeEventListener('click', this.handleSettingsToggle);
    this.settingsClose?.removeEventListener('click', this.handleSettingsClose);
    this.settingsOverlay?.removeEventListener('click', this.handleSettingsBackdrop);
    this.cameraModeToggle?.removeEventListener('change', this.handleCameraModeChange);
  }

  private readonly handleSettingsToggle = (): void => this.setSettingsOpen(!this.settingsOpen);
  private readonly handleSettingsClose = (): void => this.setSettingsOpen(false);
  private readonly handleSettingsBackdrop = (event: MouseEvent): void => {
    if (event.target === this.settingsOverlay) this.setSettingsOpen(false);
  };

  private setSettingsOpen(open: boolean): void {
    this.settingsOpen = open;
    this.keys.clear();
    this.settingsOverlay?.classList.toggle('hidden', !open);
    this.settingsToggle?.setAttribute('aria-expanded', String(open));
    if (open) this.cameraModeToggle?.focus();
    else this.settingsToggle?.focus();
  }

  private readonly handleCameraModeChange = (): void => {
    this.cameraMode = this.cameraModeToggle?.checked ? 'explorer' : 'overhead';
    this.explorerYaw = this.cameraMode === 'explorer' ? this.localCameraFocus()?.angle : undefined;
    this.explorerPitch = -0.08;
    if (this.cameraMode === 'overhead' && document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    writeCameraMode(this.cameraMode);
    this.updateCameraModeToggle();
  };

  private updateCameraModeToggle(): void {
    if (!this.cameraModeToggle) return;
    this.cameraModeToggle.checked = this.cameraMode === 'explorer';
    this.cameraModeToggle.setAttribute('aria-checked', String(this.cameraModeToggle.checked));
  }
}

function readCameraMode(): CameraPresentationMode {
  try {
    return window.localStorage.getItem(CAMERA_MODE_STORAGE_KEY) === 'explorer' ? 'explorer' : 'overhead';
  } catch {
    return 'overhead';
  }
}

function writeCameraMode(mode: CameraPresentationMode): void {
  try {
    window.localStorage.setItem(CAMERA_MODE_STORAGE_KEY, mode);
  } catch {
    // The camera remains usable when storage is unavailable.
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function isDevelopment(): boolean {
  const metaEnv = (import.meta as unknown as {env?: {DEV?: boolean}}).env;
  return metaEnv?.DEV ?? process.env.NODE_ENV !== 'production';
}

function validateOccluder(occluder: WorldGeometryOccluderDefinition, blockSize: number): void {
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

async function loadSurfaceMap(url: string): Promise<SurfaceMap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load surface manifest: ${response.status}`);
  return new SurfaceMap(await response.json());
}

async function loadMapMetadata(url: string): Promise<MapMetadataPayload> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`District metadata failed to load (${response.status}).`);
  return response.json() as Promise<MapMetadataPayload>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

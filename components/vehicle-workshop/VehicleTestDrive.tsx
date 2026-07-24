'use client';

import {Gauge, RotateCcw, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import type {VehicleWorkshopManifest} from '../../shared/content/vehicle-workshop.ts';
import {AudioBus} from '../../src/game/audio/audio-bus.ts';
import {VehicleSkidAudio} from '../../src/game/audio/vehicle-skid-audio.ts';
import {
  integrateVehicleMotionWithHandling,
  type VehicleMotionState,
  vehicleSlipAngle
} from '../../shared/simulation/vehicle-step.ts';

const LOT_WIDTH = 1792;
const LOT_HEIGHT = 1152;
const LOT_TILE_SIZE = 64;
const DISTRICT_TILE_COLUMNS = 16;
const DISTRICT_ASPHALT_TILES = [506, 541] as const;
const DISTRICT_SIDEWALK_TILES = [1036, 1041] as const;
const MAX_SKID_SEGMENTS = 700;
const SKID_LIFETIME_SECONDS = 24;

export function VehicleTestDrive(props: {
  manifest: VehicleWorkshopManifest;
  spriteUrl: string;
  onClose: () => void;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const reset = useRef<() => void>(() => undefined);
  const [speed, setSpeed] = useState(0);
  const [drifting, setDrifting] = useState(false);

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    let stopped = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | undefined;
    let disposeRuntime = () => undefined;
    const pressed = new Set<string>();
    const audioBus = new AudioBus(host);
    const skidAudio = new VehicleSkidAudio(audioBus);

    void import('three').then(async (THREE) => {
      if (stopped) return;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x171b19);
      const camera = new THREE.OrthographicCamera(-400, 400, 260, -260, 0.1, 2000);
      camera.position.set(0, 0, 600);

      const renderer = new THREE.WebGLRenderer({antialias: false, alpha: false});
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.replaceChildren(renderer.domElement);

      const districtTiles = await loadImage('/assets/maps/district-tiles.png');
      if (stopped) return;
      const lotTexture = createParkingLotTexture(THREE, districtTiles);
      const lotGeometry = new THREE.PlaneGeometry(LOT_WIDTH, LOT_HEIGHT);
      const lotMaterial = new THREE.MeshBasicMaterial({map: lotTexture});
      const lot = new THREE.Mesh(
        lotGeometry,
        lotMaterial
      );
      scene.add(lot);

      const lineMaterial = new THREE.LineBasicMaterial({color: 0xf0df9a, transparent: true, opacity: 0.75});
      const linePoints: import('three').Vector3[] = [];
      const line = (x1: number, y1: number, x2: number, y2: number) => {
        linePoints.push(new THREE.Vector3(x1, y1, 1), new THREE.Vector3(x2, y2, 1));
      };
      line(-768, -448, 768, -448);
      line(768, -448, 768, 448);
      line(768, 448, -768, 448);
      line(-768, 448, -768, -448);
      line(-704, 0, 704, 0);
      for (let x = -640; x <= 640; x += 128) {
        line(x, 320, x, 448);
        line(x, -320, x, -448);
      }
      line(-768, 320, 768, 320);
      line(-768, -320, 768, -320);
      const markings = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(linePoints),
        lineMaterial
      );
      scene.add(markings);

      const skidGeometry = new THREE.BufferGeometry();
      const skidMaterial = new THREE.LineBasicMaterial({
        color: 0x141713,
        transparent: true,
        opacity: 0.76,
        vertexColors: true
      });
      const skidMesh = new THREE.LineSegments(skidGeometry, skidMaterial);
      skidMesh.position.z = 2.5;
      scene.add(skidMesh);
      const skidSegments: SkidSegment[] = [];

      const texture = await new Promise<import('three').Texture>((resolve, reject) => {
        new THREE.TextureLoader().load(props.spriteUrl, resolve, undefined, reject);
      });
      if (stopped) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;

      const geometry = new THREE.PlaneGeometry(
        props.manifest.presentation.width,
        props.manifest.presentation.height
      );
      const offset = props.manifest.presentation.offsets.closed;
      geometry.translate(offset.x, offset.y, 0);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false
      });
      const car = new THREE.Mesh(geometry, material);
      car.position.z = 4;
      scene.add(car);

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(34, 24),
        new THREE.MeshBasicMaterial({color: 0x090b0a, transparent: true, opacity: 0.35})
      );
      shadow.scale.set(0.7, 1.35, 1);
      shadow.position.z = 2;
      scene.add(shadow);

      let motion: VehicleMotionState;
      let previousRearWheels: [Point, Point] | undefined;
      const resetMotion = () => {
        motion = {
          x: 0,
          y: -120,
          angle: Math.PI / 2,
          speed: 0,
          linvelX: 0,
          linvelY: 0,
          angvel: 0
        };
        previousRearWheels = undefined;
        skidSegments.length = 0;
        updateSkidGeometry(THREE, skidGeometry, skidSegments, performance.now());
        skidAudio.synchronize(undefined);
        setSpeed(0);
        setDrifting(false);
      };
      reset.current = resetMotion;
      resetMotion();

      const resize = () => {
        const width = Math.max(320, host.clientWidth);
        const height = Math.max(260, host.clientHeight);
        const viewHeight = 560;
        const viewWidth = viewHeight * (width / height);
        camera.left = -viewWidth / 2;
        camera.right = viewWidth / 2;
        camera.top = viewHeight / 2;
        camera.bottom = -viewHeight / 2;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      const onKeyDown = (event: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
          event.preventDefault();
        }
        if (event.code === 'Escape') props.onClose();
        if (event.code === 'KeyR') resetMotion();
        pressed.add(event.code);
      };
      const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      let previous = performance.now();
      let speedUpdatedAt = previous;
      const animate = (now: number) => {
        if (stopped) return;
        const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
        previous = now;
        const throttle = pressed.has('KeyW') || pressed.has('ArrowUp')
          ? 1
          : pressed.has('KeyS') || pressed.has('ArrowDown') ? -1 : 0;
        const steering = pressed.has('KeyA') || pressed.has('ArrowLeft')
          ? 1
          : pressed.has('KeyD') || pressed.has('ArrowRight') ? -1 : 0;
        motion = integrateVehicleMotionWithHandling(
          motion,
          {throttle, steering, handbrake: pressed.has('Space')},
          props.manifest.handling,
          delta
        );
        skidAudio.synchronize(
          {
            angle: motion.angle,
            linvelX: motion.linvelX,
            linvelY: motion.linvelY
          },
          {volume: 0.62}
        );
        const slip = Math.abs(vehicleSlipAngle(motion));
        const isDrifting = Math.abs(motion.speed) > 48 && (
          slip > 0.2 || pressed.has('Space')
        );
        const rearWheels = rearWheelPositions(motion, props.manifest.collision);
        if (isDrifting && previousRearWheels) {
          skidSegments.push(
            {from: previousRearWheels[0], to: rearWheels[0], createdAt: now},
            {from: previousRearWheels[1], to: rearWheels[1], createdAt: now}
          );
          if (skidSegments.length > MAX_SKID_SEGMENTS) {
            skidSegments.splice(0, skidSegments.length - MAX_SKID_SEGMENTS);
          }
        }
        previousRearWheels = rearWheels;
        for (let index = skidSegments.length - 1; index >= 0; index--) {
          if ((now - skidSegments[index].createdAt) / 1000 > SKID_LIFETIME_SECONDS) {
            skidSegments.splice(index, 1);
          }
        }
        updateSkidGeometry(THREE, skidGeometry, skidSegments, now);
        const limitX = 800;
        const limitY = 500;
        if (Math.abs(motion.x) > limitX || Math.abs(motion.y) > limitY) {
          motion = {
            ...motion,
            x: Math.max(-limitX, Math.min(limitX, motion.x)),
            y: Math.max(-limitY, Math.min(limitY, motion.y)),
            speed: 0,
            linvelX: 0,
            linvelY: 0,
            angvel: 0
          };
        }
        car.position.set(motion.x, motion.y, 4);
        car.rotation.z = motion.angle - Math.PI / 2;
        shadow.position.set(motion.x, motion.y, 2);
        shadow.rotation.z = car.rotation.z;
        camera.position.x += (motion.x - camera.position.x) * 0.08;
        camera.position.y += (motion.y - camera.position.y) * 0.08;
        if (now - speedUpdatedAt > 100) {
          setSpeed(Math.round(Math.abs(motion.speed)));
          setDrifting(isDrifting);
          speedUpdatedAt = now;
        }
        renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(animate);
      };
      animationFrame = requestAnimationFrame(animate);

      disposeRuntime = () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        geometry.dispose();
        material.dispose();
        texture.dispose();
        lotGeometry.dispose();
        lotMaterial.dispose();
        lotTexture.dispose();
        markings.geometry.dispose();
        lineMaterial.dispose();
        skidGeometry.dispose();
        skidMaterial.dispose();
        renderer.dispose();
      };
    }).catch((error: unknown) => {
      if (!stopped) host.textContent = error instanceof Error ? error.message : 'Unable to start test drive.';
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      disposeRuntime();
      skidAudio.destroy();
      audioBus.destroy();
      reset.current = () => undefined;
      host.replaceChildren();
    };
  }, [props.manifest, props.onClose, props.spriteUrl]);

  return (
    <section className="vw-test-drive" role="dialog" aria-modal="true" aria-label={`Test drive ${props.manifest.label}`}>
      <header>
        <div>
          <span>Private test lot</span>
          <strong>{props.manifest.label}</strong>
        </div>
        <div className="vw-test-drive__speed">
          <Gauge aria-hidden="true" />
          <strong>{speed}</strong>
          <span>speed</span>
        </div>
        <span className="vw-test-drive__drift" data-active={drifting}>
          {drifting ? 'Drifting' : 'Grip'}
        </span>
        <button type="button" className="vw-command" onClick={() => reset.current()}>
          <RotateCcw aria-hidden="true" /> Reset
        </button>
        <button type="button" className="vw-icon-button" onClick={props.onClose} aria-label="Close test drive" title="Close test drive">
          <X aria-hidden="true" />
        </button>
      </header>
      <div ref={canvasHost} className="vw-test-drive__canvas" />
      <footer>
        <span><kbd>WASD</kbd> Drive</span>
        <span><kbd>Space</kbd> Handbrake</span>
        <span><kbd>R</kbd> Reset</span>
        <span><kbd>Esc</kbd> Close</span>
      </footer>
    </section>
  );
}

interface Point {
  x: number;
  y: number;
}

interface SkidSegment {
  from: Point;
  to: Point;
  createdAt: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load map tiles from ${url}.`));
    image.src = url;
  });
}

function createParkingLotTexture(
  THREE: typeof import('three'),
  atlas: HTMLImageElement
): import('three').CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LOT_WIDTH;
  canvas.height = LOT_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable.');
  context.imageSmoothingEnabled = false;

  const columns = LOT_WIDTH / LOT_TILE_SIZE;
  const rows = LOT_HEIGHT / LOT_TILE_SIZE;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const border = row < 2 || row >= rows - 2 || column < 2 || column >= columns - 2;
      const variants = border ? DISTRICT_SIDEWALK_TILES : DISTRICT_ASPHALT_TILES;
      const variation = (column * 17 + row * 31) % 7 === 0 ? 1 : 0;
      const variant = variants[border ? (column + row) % variants.length : variation];
      drawDistrictTile(context, atlas, variant, column * LOT_TILE_SIZE, row * LOT_TILE_SIZE);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function drawDistrictTile(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  gid: number,
  x: number,
  y: number
): void {
  const index = gid - 1;
  const sourceX = (index % DISTRICT_TILE_COLUMNS) * LOT_TILE_SIZE;
  const sourceY = Math.floor(index / DISTRICT_TILE_COLUMNS) * LOT_TILE_SIZE;
  context.drawImage(
    atlas,
    sourceX,
    sourceY,
    LOT_TILE_SIZE,
    LOT_TILE_SIZE,
    x,
    y,
    LOT_TILE_SIZE,
    LOT_TILE_SIZE
  );
}

function rearWheelPositions(
  motion: VehicleMotionState,
  collision: {length: number; width: number}
): [Point, Point] {
  const forwardX = Math.cos(motion.angle);
  const forwardY = Math.sin(motion.angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  const rearOffset = collision.length * 0.28;
  const halfTrack = collision.width * 0.34;
  const rearX = motion.x - forwardX * rearOffset;
  const rearY = motion.y - forwardY * rearOffset;
  return [
    {x: rearX + sideX * halfTrack, y: rearY + sideY * halfTrack},
    {x: rearX - sideX * halfTrack, y: rearY - sideY * halfTrack}
  ];
}

function updateSkidGeometry(
  THREE: typeof import('three'),
  geometry: import('three').BufferGeometry,
  segments: readonly SkidSegment[],
  now: number
): void {
  const positions = new Float32Array(segments.length * 6);
  const colors = new Float32Array(segments.length * 6);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const offset = index * 6;
    positions.set([
      segment.from.x,
      segment.from.y,
      0,
      segment.to.x,
      segment.to.y,
      0
    ], offset);
    const age = Math.min(1, (now - segment.createdAt) / (SKID_LIFETIME_SECONDS * 1000));
    const shade = 0.1 + age * 0.35;
    colors.set([shade, shade, shade, shade, shade, shade], offset);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
}

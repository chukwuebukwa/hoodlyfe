'use client';

import {ArrowLeft, Lightbulb, RotateCcw} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {vehicleDefinition} from '../../shared/content/vehicle-catalog.ts';
import {
  updateVehicleHeadlights,
  vehicleHeadlights
} from '../../src/game/presentation/effects/vehicle-headlights.ts';
import {
  updateVehicleTaillights,
  vehicleTaillights
} from '../../src/game/presentation/effects/vehicle-taillights.ts';
import {
  updateVehicleUnderglow,
  vehicleUnderglow
} from '../../src/game/presentation/effects/vehicle-underglow.ts';

const VEHICLES = [
  {id: 's15', label: 'S15 Silvia'},
  {id: 'sedan', label: 'Sedan'},
  {id: 'suv', label: 'Compact SUV'},
  {id: 'taxi', label: 'Taxi'}
] as const;

const NEON_COLORS = [
  {id: 'cyan', label: 'Cyan', value: 0x39e7ff},
  {id: 'lime', label: 'Lime', value: 0x6dff58},
  {id: 'magenta', label: 'Magenta', value: 0xff3ec8},
  {id: 'violet', label: 'Violet', value: 0x9668ff},
  {id: 'amber', label: 'Amber', value: 0xffb13b}
] as const;

interface LightingRuntime {
  group: THREE.Group;
  headlights: ReturnType<typeof vehicleHeadlights>;
  taillights: ReturnType<typeof vehicleTaillights>;
  underglow: ReturnType<typeof vehicleUnderglow>;
}

export function VehicleLightingLab() {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<LightingRuntime | undefined>(undefined);
  const [vehicleId, setVehicleId] = useState('s15');
  const [neonColor, setNeonColor] = useState<number>(NEON_COLORS[0].value);
  const [neonStrength, setNeonStrength] = useState(0.88);
  const [lampStrength, setLampStrength] = useState(0.28);
  const [rotation, setRotation] = useState(18);
  const [neonEnabled, setNeonEnabled] = useState(true);
  const [lampsEnabled, setLampsEnabled] = useState(true);

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let disposed = false;
    let frame = 0;
    const definition = vehicleDefinition(vehicleId);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f0f);
    const camera = new THREE.OrthographicCamera(-150, 150, 105, -105, 0.1, 500);
    camera.position.set(0, 0, 200);

    const renderer = new THREE.WebGLRenderer({antialias: false});
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(Math.max(320, target.clientWidth), Math.max(280, target.clientHeight), false);
    target.replaceChildren(renderer.domElement);

    const roadTexture = lightingLabRoadTexture();
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 300),
      new THREE.MeshBasicMaterial({map: roadTexture})
    );
    scene.add(road);

    const vehicleGroup = new THREE.Group();
    const underglow = vehicleUnderglow(definition.collision.length, definition.collision.width);
    underglow.position.z = 1;
    vehicleGroup.add(underglow);

    const headlights = vehicleHeadlights(
      definition.collision.length,
      definition.collision.width,
      definition.presentation.lights.halfWidth
    );
    headlights.position.set(definition.presentation.lights.front, 0, 1.2);
    vehicleGroup.add(headlights);

    const taillights = vehicleTaillights(
      definition.collision.length,
      definition.collision.width,
      definition.presentation.lights.halfWidth
    );
    taillights.position.set(definition.presentation.lights.rear, 0, 1.2);
    vehicleGroup.add(taillights);

    const loader = new THREE.TextureLoader();
    const texture = loader.load(
      `/assets/custom/vehicles/${vehicleId}/closed.png`,
      () => {
        if (!disposed) renderer.render(scene, camera);
      }
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const spriteGeometry = new THREE.PlaneGeometry(
      definition.presentation.width,
      definition.presentation.height
    );
    const offset = definition.presentation.offsets[0];
    spriteGeometry.translate(offset?.x ?? 0, offset?.y ?? 0, 0);
    const sprite = new THREE.Mesh(
      spriteGeometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.04,
        depthWrite: false
      })
    );
    sprite.renderOrder = 10;
    sprite.rotation.z = -Math.PI / 2;
    sprite.position.z = 3;
    vehicleGroup.add(sprite);
    scene.add(vehicleGroup);

    runtime.current = {group: vehicleGroup, headlights, taillights, underglow};
    const resize = new ResizeObserver(() => {
      const width = Math.max(320, target.clientWidth);
      const height = Math.max(280, target.clientHeight);
      const viewHeight = 210;
      const viewWidth = viewHeight * width / height;
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resize.observe(target);

    const draw = () => {
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      runtime.current = undefined;
      disposeTree(vehicleGroup);
      road.geometry.dispose();
      road.material.dispose();
      roadTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [vehicleId]);

  useEffect(() => {
    const active = runtime.current;
    if (!active) return;
    active.group.rotation.z = rotation * Math.PI / 180;
    active.underglow.visible = neonEnabled;
    updateVehicleUnderglow(active.underglow, neonColor, neonEnabled ? neonStrength : 0);
    active.headlights.visible = lampsEnabled;
    active.taillights.visible = lampsEnabled;
    updateVehicleHeadlights(active.headlights, 0xfff2c7, lampsEnabled ? lampStrength : 0);
    updateVehicleTaillights(active.taillights, 0xff1f2f, lampsEnabled ? 0.26 : 0);
  }, [lampStrength, lampsEnabled, neonColor, neonEnabled, neonStrength, rotation, vehicleId]);

  return (
    <main id="vehicle-lighting-lab">
      <header className="vwl-header">
        <a className="vw-icon-button" href="/vehicles" aria-label="Back to Vehicle Workshop">
          <ArrowLeft aria-hidden="true" />
        </a>
        <div>
          <strong>Vehicle Lighting Lab</strong>
          <span>Production shader preview</span>
        </div>
        <Lightbulb aria-hidden="true" />
      </header>

      <section className="vwl-stage" aria-label="Isolated vehicle lighting preview">
        <div ref={host} className="vwl-canvas" />
        <div className="vwl-stage__readout">
          <span>{VEHICLES.find((vehicle) => vehicle.id === vehicleId)?.label}</span>
          <strong>{Math.round(neonStrength * 100)}% neon</strong>
        </div>
      </section>

      <aside className="vwl-controls">
        <label className="vwl-field">
          <span>Vehicle</span>
          <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            {VEHICLES.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
            ))}
          </select>
        </label>

        <fieldset className="vwl-field">
          <legend>Neon color</legend>
          <div className="vwl-swatches">
            {NEON_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={neonColor === color.value ? 'is-active' : ''}
                style={{'--vwl-swatch': `#${color.value.toString(16).padStart(6, '0')}`} as React.CSSProperties}
                aria-label={color.label}
                aria-pressed={neonColor === color.value}
                onClick={() => setNeonColor(color.value)}
              />
            ))}
          </div>
        </fieldset>

        <label className="vwl-field">
          <span>Neon strength <output>{neonStrength.toFixed(2)}</output></span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={neonStrength}
            onChange={(event) => setNeonStrength(Number(event.target.value))}
          />
        </label>

        <label className="vwl-field">
          <span>Lamp strength <output>{lampStrength.toFixed(2)}</output></span>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={lampStrength}
            onChange={(event) => setLampStrength(Number(event.target.value))}
          />
        </label>

        <label className="vwl-field">
          <span>Rotation <output>{rotation}°</output></span>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value))}
          />
        </label>

        <div className="vwl-toggles">
          <label><input type="checkbox" checked={neonEnabled} onChange={(event) => setNeonEnabled(event.target.checked)} /> Neon</label>
          <label><input type="checkbox" checked={lampsEnabled} onChange={(event) => setLampsEnabled(event.target.checked)} /> Lamps</label>
        </div>

        <button
          type="button"
          className="vw-command"
          onClick={() => {
            setNeonStrength(0.88);
            setLampStrength(0.28);
            setRotation(18);
            setNeonEnabled(true);
            setLampsEnabled(true);
          }}
        >
          <RotateCcw aria-hidden="true" />
          Reset
        </button>
      </aside>
    </main>
  );
}

function lightingLabRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);
  context.fillStyle = '#101515';
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = '#1b2423';
  context.lineWidth = 2;
  for (let position = 0; position <= 512; position += 32) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, 512);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(512, position);
    context.stroke();
  }
  context.strokeStyle = '#242d2b';
  context.lineWidth = 1;
  for (let position = 16; position < 512; position += 32) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, 512);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(512, position);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
  });
}

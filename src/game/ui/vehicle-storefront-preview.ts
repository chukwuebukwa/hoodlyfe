import * as THREE from 'three';
import {vehicleDefinition, type VehicleKind} from '../../../shared/content/vehicle-catalog.ts';
import {
  normalizeVehicleNeonColor,
  vehicleNeonColorHex,
  type VehicleNeonColor
} from '../../../shared/content/vehicle-neon.ts';
import {
  updateVehicleHeadlights,
  vehicleHeadlights
} from '../presentation/effects/vehicle-headlights.ts';
import {
  updateVehicleTaillights,
  vehicleTaillights
} from '../presentation/effects/vehicle-taillights.ts';
import {
  updateVehicleUnderglow,
  vehicleUnderglow,
  type VehicleUnderglow
} from '../presentation/effects/vehicle-underglow.ts';

export class VehicleStorefrontPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-135, 135, 96, -96, 0.1, 500);
  private readonly renderer = new THREE.WebGLRenderer({antialias: false});
  private readonly resize: ResizeObserver;
  private vehicle?: THREE.Group;
  private underglow?: VehicleUnderglow;

  constructor(private readonly host: HTMLElement) {
    this.scene.background = new THREE.Color(0x0a0e0f);
    this.camera.position.set(0, 0, 200);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.host.replaceChildren(this.renderer.domElement);

    const roadTexture = garageFloorTexture();
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 300),
      new THREE.MeshBasicMaterial({map: roadTexture})
    );
    road.userData.disposableTexture = roadTexture;
    this.scene.add(road);

    this.resize = new ResizeObserver(() => this.resizeRenderer());
    this.resize.observe(this.host);
    this.resizeRenderer();
  }

  show(kind: VehicleKind, neonColor: VehicleNeonColor): void {
    this.removeVehicle();
    const definition = vehicleDefinition(kind);
    const group = new THREE.Group();
    group.rotation.z = Math.PI * 0.1;

    const underglow = vehicleUnderglow(definition.collision.length, definition.collision.width);
    underglow.position.z = 1;
    group.add(underglow);

    const headlights = vehicleHeadlights(
      definition.collision.length,
      definition.collision.width,
      definition.presentation.lights.halfWidth
    );
    headlights.position.set(definition.presentation.lights.front, 0, 1.2);
    headlights.visible = true;
    updateVehicleHeadlights(headlights, 0xfff2c7, 0.22);
    group.add(headlights);

    const taillights = vehicleTaillights(
      definition.collision.length,
      definition.collision.width,
      definition.presentation.lights.halfWidth
    );
    taillights.position.set(definition.presentation.lights.rear, 0, 1.2);
    taillights.visible = true;
    updateVehicleTaillights(taillights, 0xff1f2f, 0.2);
    group.add(taillights);

    const texture = new THREE.TextureLoader().load(
      `/assets/custom/vehicles/${definition.id}/closed.png`,
      () => this.render()
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const offset = definition.presentation.offsets[0];
    const geometry = new THREE.PlaneGeometry(
      definition.presentation.width,
      definition.presentation.height
    );
    geometry.translate(offset?.x ?? 0, offset?.y ?? 0, 0);
    const sprite = new THREE.Mesh(
      geometry,
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
    group.add(sprite);

    this.vehicle = group;
    this.underglow = underglow;
    this.scene.add(group);
    this.setNeon(neonColor);
  }

  setNeon(color: VehicleNeonColor): void {
    if (!this.underglow) return;
    const normalized = normalizeVehicleNeonColor(color);
    this.underglow.visible = normalized !== 'off';
    updateVehicleUnderglow(
      this.underglow,
      vehicleNeonColorHex(normalized),
      normalized === 'off' ? 0 : 0.9
    );
    this.render();
  }

  destroy(): void {
    this.resize.disconnect();
    this.removeVehicle();
    for (const child of [...this.scene.children]) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
      const texture = child.userData.disposableTexture;
      if (texture instanceof THREE.Texture) texture.dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resizeRenderer(): void {
    const width = Math.max(280, this.host.clientWidth);
    const height = Math.max(240, this.host.clientHeight);
    const viewHeight = 192;
    const viewWidth = viewHeight * width / height;
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  private removeVehicle(): void {
    if (!this.vehicle) return;
    this.scene.remove(this.vehicle);
    disposeTree(this.vehicle);
    this.vehicle = undefined;
    this.underglow = undefined;
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function garageFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#0b1011';
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = 'rgba(130, 150, 148, 0.13)';
    context.lineWidth = 1;
    for (let position = 0; position <= 256; position += 32) {
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position, 256);
      context.stroke();
      context.beginPath();
      context.moveTo(0, position);
      context.lineTo(256, position);
      context.stroke();
    }
    context.strokeStyle = 'rgba(240, 197, 63, 0.24)';
    context.lineWidth = 2;
    context.strokeRect(42, 18, 172, 220);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.4, 1.4);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
      material.dispose();
    }
  });
}

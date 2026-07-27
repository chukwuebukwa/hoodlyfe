import * as THREE from 'three';
import {radialGlow} from './glow.ts';

export interface ShopBeaconOptions {
  color: number;
  intensity?: number;
  placement?: ShopBeaconPlacement;
  radius?: number;
  footprintSize?: readonly [width: number, height: number];
  footprintZ?: number;
}

export interface ShopBeaconPlacement {
  position: readonly [x: number, y: number, z: number];
  aimOffset: readonly [x: number, y: number, z: number];
}

export const REPAIR_SHOP_BEACON_PLACEMENT: ShopBeaconPlacement = {
  position: [80, 22, 136],
  aimOffset: [60, -104, -101]
};

export const REPAIR_ALLEY_BEACON_PLACEMENT: ShopBeaconPlacement = {
  position: [216, 280, 108],
  aimOffset: [-70, -96, -73]
};

const BEACON_LIGHT_OFFSET = new THREE.Vector3(0, -46, -62);
const BEACON_RADIUS = 88;
const BEACON_FOOTPRINT_SIZE = [215.6, 176] as const;

export function createShopBeacon(options: ShopBeaconOptions): THREE.Group {
  const color = new THREE.Color(options.color);
  const intensity = options.intensity ?? 1;
  const placement = options.placement ?? REPAIR_SHOP_BEACON_PLACEMENT;
  const group = new THREE.Group();
  group.name = 'shop-beacon';
  group.userData.disableMarkerPulse = true;

  const source = new THREE.Vector3().fromArray(placement.position);
  const target = source.clone().add(new THREE.Vector3().fromArray(placement.aimOffset));
  const coneRadius = options.radius ?? BEACON_RADIUS;
  const footprintSize = options.footprintSize ?? BEACON_FOOTPRINT_SIZE;
  const volumeScale = coneRadius / BEACON_RADIUS;

  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(footprintSize[0], footprintSize[1]),
    new THREE.ShaderMaterial({
      uniforms: {
        beaconColor: {value: color.clone()},
        beaconOpacity: {value: 0.48 * intensity}
      },
      vertexShader: `
        varying vec2 beaconUv;
        void main() {
          beaconUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 beaconUv;
        uniform vec3 beaconColor;
        uniform float beaconOpacity;
        void main() {
          vec2 point = beaconUv * 2.0 - 1.0;
          float ellipse = dot(point, point);
          float edgeSoftness = 1.0 - smoothstep(0.34, 1.0, ellipse);
          float pool = exp(-2.8 * ellipse);
          float breakup = 0.92 + 0.08 * sin(point.x * 19.0 + point.y * 37.0);
          float alpha = edgeSoftness * pool * breakup * beaconOpacity;
          gl_FragColor = vec4(beaconColor, alpha);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  );
  beam.name = 'shop-beacon-ray';
  beam.userData.role = 'shop-beacon-ray';
  beam.position.set(target.x, target.y, options.footprintZ ?? -5.5);
  beam.renderOrder = 16;

  const volumeMidpoint = source.clone().add(target).multiplyScalar(0.5);
  const volume = new THREE.Mesh(
    beaconVolumeGeometry(
      source,
      target,
      volumeMidpoint,
      footprintSize[0] * volumeScale,
      footprintSize[1] * volumeScale
    ),
    new THREE.ShaderMaterial({
      uniforms: {
        beaconColor: {value: color.clone()},
        beaconOpacity: {value: 0.12 * intensity}
      },
      vertexShader: `
        varying vec2 beaconUv;
        void main() {
          beaconUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 beaconUv;
        uniform vec3 beaconColor;
        uniform float beaconOpacity;
        void main() {
          float travel = 1.0 - beaconUv.y;
          float startFade = smoothstep(0.0, 0.045, travel);
          float endFade = 1.0 - smoothstep(0.76, 1.0, travel);
          float density = mix(1.0, 0.55, travel);
          float breakup = 0.94 + 0.06 * sin(beaconUv.x * 31.0 + travel * 19.0);
          float alpha = startFade * endFade * density * breakup * beaconOpacity;
          gl_FragColor = vec4(beaconColor, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  );
  volume.name = 'shop-beacon-volume';
  volume.userData.role = 'shop-beacon-volume';
  volume.position.copy(volumeMidpoint);
  volume.renderOrder = 17;

  const bloom = radialGlow(28, options.color, 0.42 * intensity, 20);
  bloom.name = 'shop-beacon-bloom';
  bloom.userData.role = 'shop-beacon-bloom';
  bloom.position.copy(source);

  const cast = new THREE.PointLight(options.color, 4.6 * intensity, 220, 2);
  cast.name = 'shop-beacon-light';
  cast.userData.role = 'shop-beacon-light';
  cast.position.copy(source).add(BEACON_LIGHT_OFFSET);

  group.add(beam, volume, bloom, cast);
  return group;
}

function beaconVolumeGeometry(
  source: THREE.Vector3,
  target: THREE.Vector3,
  origin: THREE.Vector3,
  baseWidth: number,
  baseHeight: number
): THREE.BufferGeometry {
  const segments = 48;
  const positions: number[] = [];
  const uvs: number[] = [];
  const sourceLocal = source.clone().sub(origin);
  const halfWidth = baseWidth / 2;
  const halfHeight = baseHeight / 2;

  for (let index = 0; index < segments; index++) {
    const start = index / segments;
    const end = (index + 1) / segments;
    const startAngle = start * Math.PI * 2;
    const endAngle = end * Math.PI * 2;
    const startPoint = new THREE.Vector3(
      target.x + Math.cos(startAngle) * halfWidth,
      target.y + Math.sin(startAngle) * halfHeight,
      target.z
    ).sub(origin);
    const endPoint = new THREE.Vector3(
      target.x + Math.cos(endAngle) * halfWidth,
      target.y + Math.sin(endAngle) * halfHeight,
      target.z
    ).sub(origin);

    positions.push(
      sourceLocal.x, sourceLocal.y, sourceLocal.z,
      startPoint.x, startPoint.y, startPoint.z,
      endPoint.x, endPoint.y, endPoint.z
    );
    uvs.push(0.5, 1, start, 0, end, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

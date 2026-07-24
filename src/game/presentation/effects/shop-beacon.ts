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

  const volumeDirection = source.clone().sub(target);
  const volumeLength = volumeDirection.length();
  const volumeMidpoint = source.clone().add(target).multiplyScalar(0.5);
  const volumeAlignment = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    volumeDirection.normalize()
  );
  const volume = new THREE.Mesh(
    new THREE.ConeGeometry(coneRadius, volumeLength, 48, 1, true),
    new THREE.ShaderMaterial({
      uniforms: {
        beaconColor: {value: color.clone()},
        beaconOpacity: {value: 0.12 * intensity}
      },
      vertexShader: `
        varying vec2 beaconUv;
        varying vec3 beaconNormal;
        varying vec3 beaconViewDirection;
        void main() {
          beaconUv = uv;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          beaconNormal = normalize(normalMatrix * normal);
          beaconViewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        varying vec2 beaconUv;
        varying vec3 beaconNormal;
        varying vec3 beaconViewDirection;
        uniform vec3 beaconColor;
        uniform float beaconOpacity;
        void main() {
          float travel = 1.0 - beaconUv.y;
          float silhouette = abs(dot(
            normalize(beaconNormal),
            normalize(beaconViewDirection)
          ));
          float edgeFade = smoothstep(0.04, 0.42, silhouette);
          float startFade = smoothstep(0.0, 0.045, travel);
          float endFade = 1.0 - smoothstep(0.76, 1.0, travel);
          float density = mix(1.0, 0.55, travel);
          float breakup = 0.94 + 0.06 * sin(beaconUv.x * 31.0 + travel * 19.0);
          float alpha = edgeFade * startFade * endFade
            * density * breakup * beaconOpacity;
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
  volume.name = 'shop-beacon-volume';
  volume.userData.role = 'shop-beacon-volume';
  volume.position.copy(volumeMidpoint);
  volume.quaternion.copy(volumeAlignment);
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

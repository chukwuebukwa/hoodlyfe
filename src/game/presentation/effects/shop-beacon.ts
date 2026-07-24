import * as THREE from 'three';
import {radialGlow} from './glow.ts';

export interface ShopBeaconOptions {
  color: number;
  intensity?: number;
}

export function createShopBeacon(options: ShopBeaconOptions): THREE.Group {
  const color = new THREE.Color(options.color);
  const intensity = options.intensity ?? 1;
  const group = new THREE.Group();
  group.name = 'shop-beacon';
  group.userData.disableMarkerPulse = true;

  const source = new THREE.Vector3(0, 62, 68);
  const target = new THREE.Vector3(0, -82, -5);

  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 230),
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
          float travel = 1.0 - beaconUv.y;
          float beamWidth = mix(0.07, 0.82, pow(travel, 0.82));
          float edgeSoftness = 1.0 - smoothstep(
            beamWidth * 0.52,
            beamWidth,
            abs(point.x)
          );
          float startFade = smoothstep(0.0, 0.10, travel);
          float endFade = 1.0 - smoothstep(0.72, 1.0, travel);
          float beamBody = edgeSoftness * startFade * endFade;

          vec2 poolPoint = vec2(point.x * 0.88, (travel - 0.70) * 2.15);
          float pool = exp(-4.2 * dot(poolPoint, poolPoint));
          float breakup = 0.92 + 0.08 * sin(point.x * 19.0 + point.y * 37.0);
          float alpha = (beamBody * 0.48 + pool * 0.30) * breakup * beaconOpacity;
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
  beam.position.set(0, -45, -5.5);
  beam.renderOrder = 16;

  const volumeDirection = source.clone().sub(target);
  const volumeLength = volumeDirection.length();
  const volumeMidpoint = source.clone().add(target).multiplyScalar(0.5);
  const volumeAlignment = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    volumeDirection.normalize()
  );
  const volume = new THREE.Mesh(
    new THREE.ConeGeometry(96, volumeLength, 48, 1, true),
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
  cast.position.set(0, 24, 34);

  group.add(beam, volume, bloom, cast);
  return group;
}

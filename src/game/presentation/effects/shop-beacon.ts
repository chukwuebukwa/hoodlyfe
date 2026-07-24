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
  const target = new THREE.Vector3(0, -58, -5);

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

  const volume = new THREE.Group();
  volume.name = 'shop-beacon-volume';
  volume.userData.role = 'shop-beacon-volume';
  const volumeDirection = source.clone().sub(target);
  const volumeLength = volumeDirection.length();
  const volumeMidpoint = source.clone().add(target).multiplyScalar(0.5);
  const volumeAlignment = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    volumeDirection.normalize()
  );
  for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
    const blade = new THREE.Mesh(
      new THREE.PlaneGeometry(126, volumeLength),
      new THREE.ShaderMaterial({
        uniforms: {
          beaconColor: {value: color.clone()},
          beaconOpacity: {value: 0.13 * intensity}
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
            float volumeWidth = mix(0.015, 0.58, pow(travel, 0.82));
            float normalizedEdge = abs(point.x) / max(volumeWidth, 0.001);
            float edgeSoftness = 1.0 - smoothstep(0.24, 1.0, normalizedEdge);
            float startFade = smoothstep(0.0, 0.025, travel);
            float endFade = 1.0 - smoothstep(0.70, 1.0, travel);
            float centerDensity = mix(1.0, 0.58, normalizedEdge);
            float alpha = edgeSoftness * startFade * endFade
              * centerDensity * beaconOpacity;
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
    blade.name = 'shop-beacon-volume-blade';
    blade.userData.role = 'shop-beacon-volume-blade';
    blade.position.copy(volumeMidpoint);
    blade.quaternion.copy(volumeAlignment).multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
    );
    blade.renderOrder = 17;
    volume.add(blade);
  }

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

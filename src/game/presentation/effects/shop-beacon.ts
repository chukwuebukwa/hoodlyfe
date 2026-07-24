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

  const bloom = radialGlow(44, options.color, 0.48 * intensity, 20);
  bloom.name = 'shop-beacon-bloom';
  bloom.userData.role = 'shop-beacon-bloom';
  bloom.position.copy(source);

  const cast = new THREE.PointLight(options.color, 4.6 * intensity, 220, 2);
  cast.name = 'shop-beacon-light';
  cast.userData.role = 'shop-beacon-light';
  cast.position.set(0, 24, 34);

  group.add(beam, bloom, cast);
  return group;
}

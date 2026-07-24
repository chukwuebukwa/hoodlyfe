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

  const source = new THREE.Vector3(0, 62, 68);
  const target = new THREE.Vector3(0, -58, -5);
  const beamDirection = source.clone().sub(target);
  const beamLength = beamDirection.length();

  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(58, beamLength, 32, 1, true),
    new THREE.ShaderMaterial({
      uniforms: {
        beaconColor: {value: color.clone()},
        beaconOpacity: {value: 0.16 * intensity}
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
          float heightFade = pow(sin(clamp(beaconUv.y, 0.0, 1.0) * 3.14159265), 0.55);
          float shimmer = 0.94 + 0.06 * sin(beaconUv.x * 43.0 + beaconUv.y * 17.0);
          gl_FragColor = vec4(beaconColor, beaconOpacity * heightFade * shimmer);
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
  beam.position.copy(source).add(target).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    beamDirection.normalize()
  );
  beam.renderOrder = 16;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 190),
    new THREE.ShaderMaterial({
      uniforms: {
        beaconColor: {value: color.clone()},
        beaconOpacity: {value: 0.52 * intensity}
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
          float progress = clamp((point.y + 1.0) * 0.5, 0.0, 1.0);
          float beamWidth = mix(0.16, 0.88, progress);
          float lateral = 1.0 - smoothstep(beamWidth * 0.56, beamWidth, abs(point.x));
          float longitudinal = smoothstep(-1.0, -0.72, point.y)
            * (1.0 - smoothstep(0.58, 1.0, point.y));
          vec2 poolPoint = vec2(point.x * 0.82, (point.y - 0.36) * 0.74);
          float pool = exp(-3.15 * dot(poolPoint, poolPoint));
          float alpha = (lateral * longitudinal * 0.46 + pool * 0.68) * beaconOpacity;
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
  ground.name = 'shop-beacon-ground';
  ground.userData.role = 'shop-beacon-ground';
  ground.position.set(0, -4, -5.5);
  ground.renderOrder = 15;

  const bloom = radialGlow(76, options.color, 0.76 * intensity, 20);
  bloom.name = 'shop-beacon-bloom';
  bloom.userData.role = 'shop-beacon-bloom';
  bloom.position.copy(source);

  const cast = new THREE.PointLight(options.color, 4.6 * intensity, 220, 2);
  cast.name = 'shop-beacon-light';
  cast.userData.role = 'shop-beacon-light';
  cast.position.set(0, 24, 34);

  group.add(ground, beam, bloom, cast);
  return group;
}

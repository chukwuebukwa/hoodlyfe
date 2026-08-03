import * as THREE from 'three';
import {radialGlow, updateRadialGlow, type RadialGlow} from './glow.ts';

export interface PoliceSearchlight {
  group: THREE.Group;
  footprint: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  volume: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  sourceGlow: RadialGlow;
}

export interface PoliceSearchlightPose {
  source: THREE.Vector3;
  target: THREE.Vector3;
  radius: number;
  intensity: number;
  detail?: PoliceSearchlightDetail;
}

export type PoliceSearchlightDetail = 'full' | 'footprint' | 'hidden';

const SEARCHLIGHT_COLOR = 0xffffff;
const UP = new THREE.Vector3(0, 1, 0);
const FROM_TARGET_TO_SOURCE = new THREE.Vector3();
const MIDPOINT = new THREE.Vector3();
const FULL_DETAIL_DISTANCE = 850;
const FOOTPRINT_DETAIL_DISTANCE = 1_500;

export function policeSearchlightDetailForDistance(distance: number): PoliceSearchlightDetail {
  if (!Number.isFinite(distance) || distance < 0) return 'hidden';
  if (distance <= FULL_DETAIL_DISTANCE) return 'full';
  if (distance <= FOOTPRINT_DETAIL_DISTANCE) return 'footprint';
  return 'hidden';
}

export function createPoliceSearchlight(): PoliceSearchlight {
  const color = new THREE.Color(SEARCHLIGHT_COLOR);
  const footprint = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        searchlightColor: {value: color.clone()},
        searchlightOpacity: {value: 0}
      },
      vertexShader: `
        varying vec2 searchlightUv;
        void main() {
          searchlightUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 searchlightUv;
        uniform vec3 searchlightColor;
        uniform float searchlightOpacity;
        void main() {
          vec2 point = searchlightUv * 2.0 - 1.0;
          float ellipse = dot(point, point);
          float edge = 1.0 - smoothstep(0.28, 1.0, ellipse);
          float pool = exp(-2.35 * ellipse);
          gl_FragColor = vec4(searchlightColor, edge * pool * searchlightOpacity);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false
    })
  );
  footprint.name = 'police-searchlight-footprint';
  footprint.renderOrder = 16;

  const volume = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 1, 1, 16, 1, true),
    new THREE.ShaderMaterial({
      uniforms: {
        searchlightColor: {value: color.clone()},
        searchlightOpacity: {value: 0}
      },
      vertexShader: `
        varying vec2 searchlightUv;
        void main() {
          searchlightUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 searchlightUv;
        uniform vec3 searchlightColor;
        uniform float searchlightOpacity;
        void main() {
          float travel = searchlightUv.y;
          float sourceFade = smoothstep(0.0, 0.09, travel);
          float groundFade = 1.0 - smoothstep(0.78, 1.0, travel);
          float density = mix(0.62, 1.0, travel);
          gl_FragColor = vec4(
            searchlightColor,
            sourceFade * groundFade * density * searchlightOpacity
          );
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false
    })
  );
  volume.name = 'police-searchlight-volume';
  volume.renderOrder = 17;

  const sourceGlow = radialGlow(34, SEARCHLIGHT_COLOR, 0, 20);
  sourceGlow.name = 'police-searchlight-source';
  const group = new THREE.Group();
  group.name = 'police-searchlight';
  group.add(footprint, volume, sourceGlow);
  return {group, footprint, volume, sourceGlow};
}

export function updatePoliceSearchlight(
  searchlight: PoliceSearchlight,
  pose: PoliceSearchlightPose
): void {
  const radius = Math.max(1, pose.radius);
  const intensity = Math.max(0, Math.min(1, pose.intensity));
  const detail = pose.detail ?? 'full';
  searchlight.group.visible = intensity > 0.01 && detail !== 'hidden';
  if (!searchlight.group.visible) return;

  searchlight.footprint.visible = true;
  searchlight.footprint.position.copy(pose.target);
  searchlight.footprint.scale.set(radius, radius * 0.78, 1);
  searchlight.footprint.material.uniforms.searchlightOpacity.value = 0.58 * intensity;

  const showVolume = detail === 'full';
  searchlight.volume.visible = showVolume;
  searchlight.sourceGlow.visible = showVolume;
  if (!showVolume) return;

  FROM_TARGET_TO_SOURCE.subVectors(pose.source, pose.target);
  const length = Math.max(1, FROM_TARGET_TO_SOURCE.length());
  MIDPOINT.addVectors(pose.source, pose.target).multiplyScalar(0.5);
  searchlight.volume.position.copy(MIDPOINT);
  searchlight.volume.quaternion.setFromUnitVectors(UP, FROM_TARGET_TO_SOURCE.normalize());
  searchlight.volume.scale.set(radius * 1.08, length, radius * 0.84);
  searchlight.volume.material.uniforms.searchlightOpacity.value = 0.14 * intensity;

  searchlight.sourceGlow.position.copy(pose.source);
  updateRadialGlow(searchlight.sourceGlow, SEARCHLIGHT_COLOR, 0.5 * intensity);
}

export function disposePoliceSearchlight(searchlight: PoliceSearchlight): void {
  searchlight.group.removeFromParent();
  searchlight.footprint.geometry.dispose();
  searchlight.footprint.material.dispose();
  searchlight.volume.geometry.dispose();
  searchlight.volume.material.dispose();
  searchlight.sourceGlow.geometry.dispose();
  searchlight.sourceGlow.material.dispose();
}

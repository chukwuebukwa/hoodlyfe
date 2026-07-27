import * as THREE from 'three';

export type VehicleHeadlights = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

const BEAM_OVERLAP = 5;

export function vehicleHeadlights(
  length: number,
  width: number,
  lampHalfWidth = width * 0.32
): VehicleHeadlights {
  const beamLength = Math.max(70, length * 1.28);
  const beamWidth = Math.max(48, width * 1.7);
  const totalLength = beamLength + BEAM_OVERLAP;
  const sourceU = BEAM_OVERLAP / totalLength;
  const lampOffset = Math.max(0.12, Math.min(0.3, lampHalfWidth / beamWidth));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      beamColor: {value: new THREE.Color(0xfff2c7)},
      beamOpacity: {value: 0},
      lampOffset: {value: lampOffset},
      sourceU: {value: sourceU}
    },
    vertexShader: `
      varying vec2 beamUv;
      void main() {
        beamUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 beamUv;
      uniform vec3 beamColor;
      uniform float beamOpacity;
      uniform float lampOffset;
      uniform float sourceU;

      void main() {
        float forward = max(0.0, (beamUv.x - sourceU) / (1.0 - sourceU));
        float forwardGate = smoothstep(sourceU - 0.008, sourceU + 0.025, beamUv.x);
        float beamHalfWidth = mix(0.055, 0.4, pow(forward, 0.7));
        float leftDistance = abs(beamUv.y - (0.5 - lampOffset));
        float rightDistance = abs(beamUv.y - (0.5 + lampOffset));
        float leftCone = 1.0 - smoothstep(
          beamHalfWidth * 0.48,
          beamHalfWidth,
          leftDistance
        );
        float rightCone = 1.0 - smoothstep(
          beamHalfWidth * 0.48,
          beamHalfWidth,
          rightDistance
        );
        float distanceFade = exp(-1.9 * forward) * (1.0 - smoothstep(0.64, 1.0, forward));
        float beam = min(1.0, leftCone + rightCone) * distanceFade * forwardGate;

        vec2 leftLampPoint = vec2(
          (beamUv.x - sourceU) * 4.2,
          (beamUv.y - (0.5 - lampOffset)) * 2.4
        );
        vec2 rightLampPoint = vec2(
          (beamUv.x - sourceU) * 4.2,
          (beamUv.y - (0.5 + lampOffset)) * 2.4
        );
        float lampSource = max(
          exp(-95.0 * dot(leftLampPoint, leftLampPoint)),
          exp(-95.0 * dot(rightLampPoint, rightLampPoint))
        );

        float alpha = (beam * 0.42 + lampSource * 1.24) * beamOpacity;
        vec3 emittedColor = mix(beamColor, vec3(1.0), lampSource * 0.58);
        gl_FragColor = vec4(emittedColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const geometry = new THREE.PlaneGeometry(totalLength, beamWidth);
  geometry.translate((beamLength - BEAM_OVERLAP) / 2, 0, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 9;
  mesh.visible = false;
  return mesh;
}

export function updateVehicleHeadlights(
  headlights: VehicleHeadlights,
  color: number,
  opacity: number
): void {
  (headlights.material.uniforms.beamColor.value as THREE.Color).setHex(color);
  headlights.material.uniforms.beamOpacity.value = opacity;
}

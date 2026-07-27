import * as THREE from 'three';

export type VehicleTaillights = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

const ROAD_OVERLAP = 4;

export function vehicleTaillights(
  length: number,
  width: number,
  lampHalfWidth = width * 0.32
): VehicleTaillights {
  const spillLength = Math.max(22, length * 0.38);
  const spillWidth = Math.max(40, width * 1.35);
  const totalLength = spillLength + ROAD_OVERLAP;
  const sourceU = spillLength / totalLength;
  const lampOffset = Math.max(0.15, Math.min(0.32, lampHalfWidth / spillWidth));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      lampColor: {value: new THREE.Color(0xff1f2f)},
      lampOpacity: {value: 0},
      lampOffset: {value: lampOffset},
      sourceU: {value: sourceU}
    },
    vertexShader: `
      varying vec2 lampUv;
      void main() {
        lampUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 lampUv;
      uniform vec3 lampColor;
      uniform float lampOpacity;
      uniform float lampOffset;
      uniform float sourceU;

      void main() {
        float backward = max(0.0, (sourceU - lampUv.x) / sourceU);
        float backwardGate = 1.0 - smoothstep(sourceU - 0.018, sourceU + 0.008, lampUv.x);
        float spillHalfWidth = mix(0.045, 0.34, pow(backward, 0.72));
        float leftDistance = abs(lampUv.y - (0.5 - lampOffset));
        float rightDistance = abs(lampUv.y - (0.5 + lampOffset));
        float leftSpill = 1.0 - smoothstep(
          spillHalfWidth * 0.42,
          spillHalfWidth,
          leftDistance
        );
        float rightSpill = 1.0 - smoothstep(
          spillHalfWidth * 0.42,
          spillHalfWidth,
          rightDistance
        );
        float roadSpill = min(1.0, leftSpill + rightSpill)
          * exp(-2.8 * backward)
          * (1.0 - smoothstep(0.62, 1.0, backward))
          * backwardGate;

        vec2 leftLampPoint = vec2(
          (lampUv.x - sourceU) * 5.2,
          (lampUv.y - (0.5 - lampOffset)) * 2.8
        );
        vec2 rightLampPoint = vec2(
          (lampUv.x - sourceU) * 5.2,
          (lampUv.y - (0.5 + lampOffset)) * 2.8
        );
        float lampSource = max(
          exp(-115.0 * dot(leftLampPoint, leftLampPoint)),
          exp(-115.0 * dot(rightLampPoint, rightLampPoint))
        );

        float alpha = (roadSpill * 0.32 + lampSource * 1.48) * lampOpacity;
        vec3 emittedColor = mix(lampColor, vec3(1.0), lampSource * 0.18);
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
  const geometry = new THREE.PlaneGeometry(totalLength, spillWidth);
  geometry.translate((-spillLength + ROAD_OVERLAP) / 2, 0, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 9;
  mesh.visible = false;
  return mesh;
}

export function updateVehicleTaillights(
  taillights: VehicleTaillights,
  color: number,
  opacity: number
): void {
  (taillights.material.uniforms.lampColor.value as THREE.Color).setHex(color);
  taillights.material.uniforms.lampOpacity.value = opacity;
}

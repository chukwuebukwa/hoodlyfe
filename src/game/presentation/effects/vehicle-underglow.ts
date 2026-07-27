import * as THREE from 'three';

export type VehicleUnderglow = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

export function vehicleUnderglowRotation(spriteRotation: number): number {
  return spriteRotation + Math.PI / 2;
}

export function vehicleUnderglow(length: number, width: number): VehicleUnderglow {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: {value: new THREE.Color(0x39e7ff)},
      glowOpacity: {value: 0}
    },
    vertexShader: `
      varying vec2 glowUv;
      void main() {
        glowUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 glowUv;
      uniform vec3 glowColor;
      uniform float glowOpacity;
      void main() {
        vec2 point = glowUv * 2.0 - 1.0;
        vec2 ellipsePoint = point * vec2(0.72, 0.78);
        float radiusSquared = dot(ellipsePoint, ellipsePoint);

        // Keep a wide, low-energy road spill beyond the bodywork.
        float roadHalo = exp(-2.35 * radiusSquared);
        vec2 capsulePoint = vec2(max(abs(point.x) - 0.28, 0.0), point.y);
        float capsuleDistance = length(capsulePoint);
        float radialEdge = 1.0 - smoothstep(0.28, 0.86, capsuleDistance);
        float horizontalEdge = 1.0 - smoothstep(0.74, 1.0, abs(point.x));
        float verticalEdge = 1.0 - smoothstep(0.74, 1.0, abs(point.y));
        float boundaryFade = horizontalEdge * verticalEdge;

        // Defined rocker-panel tubes provide a readable source instead of an indistinct blur.
        float railDistance = abs(abs(point.y) - 0.31);
        float railLength = 1.0 - smoothstep(0.58, 0.73, abs(point.x));
        float railCore = exp(-620.0 * railDistance * railDistance) * railLength;
        float railBloom = exp(-52.0 * railDistance * railDistance) * railLength;
        float chassisCore = exp(-5.8 * pow(abs(point.x), 4.0))
          * exp(-34.0 * pow(abs(point.y), 4.0));

        float alpha = (
          roadHalo * 0.48
          + railBloom * 0.24
          + railCore * 0.62
          + chassisCore * 0.2
        ) * radialEdge * boundaryFade * glowOpacity;
        vec3 emittedColor = glowColor * (0.88 + railCore * 0.32);
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
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(1, length * 1.65), Math.max(1, width * 3.05)),
    material
  );
  mesh.renderOrder = 8;
  mesh.visible = false;
  return mesh;
}

export function updateVehicleUnderglow(
  glow: VehicleUnderglow,
  color: number,
  opacity: number
): void {
  (glow.material.uniforms.glowColor.value as THREE.Color).setHex(color);
  glow.material.uniforms.glowOpacity.value = opacity;
}

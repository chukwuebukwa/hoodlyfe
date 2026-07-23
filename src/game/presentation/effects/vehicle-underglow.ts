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
        vec2 ellipsePoint = point * vec2(0.78, 1.02);
        float radiusSquared = dot(ellipsePoint, ellipsePoint);

        // A broad Gaussian pool reads as light reflected by the road instead of a flat decal.
        float roadHalo = exp(-3.2 * radiusSquared);
        float radialEdge = 1.0 - smoothstep(0.76, 1.08, sqrt(radiusSquared));

        // A dim pair of tubes under the rocker panels gives the halo a believable source.
        float railDistance = abs(abs(point.y) - 0.38);
        float sideRails = exp(-68.0 * railDistance * railDistance);
        sideRails *= exp(-2.8 * pow(abs(point.x), 4.0));

        float alpha = (roadHalo * 0.68 + sideRails * 0.16) * radialEdge * glowOpacity;
        vec3 emittedColor = glowColor * (0.76 + sideRails * 0.24);
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
    new THREE.PlaneGeometry(Math.max(1, length * 1.42), Math.max(1, width * 2.05)),
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

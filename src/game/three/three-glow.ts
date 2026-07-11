import * as THREE from 'three';

export type RadialGlow = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

export function radialGlow(
  diameter: number,
  color: number,
  opacity: number,
  renderOrder: number
): RadialGlow {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: {value: new THREE.Color(color)},
      glowOpacity: {value: opacity}
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
        float distanceFromCenter = distance(glowUv, vec2(0.5));
        float alpha = (1.0 - smoothstep(0.05, 0.5, distanceFromCenter)) * glowOpacity;
        gl_FragColor = vec4(glowColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(diameter, diameter), material);
  mesh.renderOrder = renderOrder;
  return mesh;
}

export function updateRadialGlow(glow: RadialGlow, color: number, opacity: number): void {
  (glow.material.uniforms.glowColor.value as THREE.Color).setHex(color);
  glow.material.uniforms.glowOpacity.value = opacity;
}

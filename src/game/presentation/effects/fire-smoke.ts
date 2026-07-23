import * as THREE from 'three';

interface FireSmokeEffectOptions {
  radius: number;
  seed: number;
  burst?: boolean;
  fireWeight?: number;
  smokeWeight?: number;
}

interface FireSmokeUniforms {
  fireTime: THREE.IUniform<number>;
  fireIntensity: THREE.IUniform<number>;
  fireSeed: THREE.IUniform<number>;
  smokeTime: THREE.IUniform<number>;
  smokeIntensity: THREE.IUniform<number>;
  smokeSeed: THREE.IUniform<number>;
}

interface FireSmokeUserData {
  fireSmokeUniforms?: FireSmokeUniforms;
  baseRadius?: number;
  fireWeight?: number;
  smokeWeight?: number;
}

const FIRE_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FIRE_FRAGMENT_SHADER = `
  precision highp float;

  uniform float fireTime;
  uniform float fireIntensity;
  uniform float fireSeed;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.05;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float dist = length(centered);
    float core = smoothstep(0.92, 0.08, dist);
    float lick = fbm(centered * 3.2 + vec2(fireSeed, -fireTime * 2.4));
    float hot = smoothstep(0.28, 1.0, core + lick * 0.42);
    float edge = smoothstep(1.0, 0.42, dist + lick * 0.08);
    vec3 ember = vec3(0.72, 0.11, 0.02);
    vec3 orange = vec3(1.0, 0.32, 0.04);
    vec3 yellow = vec3(1.0, 0.83, 0.22);
    vec3 color = mix(ember, orange, hot);
    color = mix(color, yellow, smoothstep(0.62, 1.0, hot + core * 0.35));
    float alpha = edge * fireIntensity * (0.42 + hot * 0.58);
    gl_FragColor = vec4(color, alpha);
  }
`;

const SMOKE_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SMOKE_FRAGMENT_SHADER = `
  precision highp float;

  uniform float smokeTime;
  uniform float smokeIntensity;
  uniform float smokeSeed;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.52;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.52;
    }
    return value;
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float dist = length(centered);
    vec2 drift = vec2(smokeTime * 0.16, -smokeTime * 0.28 + smokeSeed);
    float cloud = fbm(centered * 2.15 + drift);
    float body = smoothstep(1.0, 0.12, dist + cloud * 0.18);
    float holes = smoothstep(0.23, 0.72, cloud);
    float alpha = body * holes * smokeIntensity * 0.34;
    vec3 color = mix(vec3(0.08, 0.08, 0.075), vec3(0.42, 0.40, 0.36), cloud);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createFireSmokeEffect(options: FireSmokeEffectOptions): THREE.Group {
  const baseRadius = Math.max(12, options.radius);
  const group = new THREE.Group();
  const fireUniforms = {
    fireTime: {value: 0},
    fireIntensity: {value: 1},
    fireSeed: {value: options.seed}
  };
  const smokeUniforms = {
    smokeTime: {value: 0},
    smokeIntensity: {value: options.burst ? 1.2 : 0.72},
    smokeSeed: {value: options.seed * 1.73 + 3.1}
  };
  const uniforms: FireSmokeUniforms = {
    ...fireUniforms,
    ...smokeUniforms
  };
  const fire = new THREE.Mesh(
    new THREE.PlaneGeometry(baseRadius * 1.55, baseRadius * 1.55),
    new THREE.ShaderMaterial({
      vertexShader: FIRE_VERTEX_SHADER,
      fragmentShader: FIRE_FRAGMENT_SHADER,
      uniforms: fireUniforms,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  fire.renderOrder = 32;

  const smoke = new THREE.Mesh(
    new THREE.PlaneGeometry(baseRadius * 2.8, baseRadius * 2.8),
    new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERTEX_SHADER,
      fragmentShader: SMOKE_FRAGMENT_SHADER,
      uniforms: smokeUniforms,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  smoke.position.z = options.burst ? 12 : 8;
  smoke.renderOrder = 31;

  group.add(smoke, fire);
  (group.userData as FireSmokeUserData).fireSmokeUniforms = uniforms;
  (group.userData as FireSmokeUserData).baseRadius = baseRadius;
  (group.userData as FireSmokeUserData).fireWeight = options.fireWeight ?? 1;
  (group.userData as FireSmokeUserData).smokeWeight = options.smokeWeight ?? 1;
  return group;
}

export function updateFireSmokeEffect(
  group: THREE.Object3D,
  nowMs: number,
  intensity: number,
  seedOffset = 0
): void {
  const userData = group.userData as FireSmokeUserData;
  const uniforms = userData.fireSmokeUniforms;
  if (!uniforms) return;
  const clamped = Math.max(0, Math.min(1.5, intensity));
  const fireWeight = userData.fireWeight ?? 1;
  const smokeWeight = userData.smokeWeight ?? 1;
  const seconds = nowMs / 1000;
  uniforms.fireTime.value = seconds + seedOffset * 0.13;
  uniforms.smokeTime.value = seconds + seedOffset * 0.09;
  uniforms.fireIntensity.value = clamped * fireWeight;
  uniforms.smokeIntensity.value = clamped * 0.78 * smokeWeight;
}

/**
 * Visual crash-feel harness: plays the golden scenarios through the engine
 * with live ContactTuning sliders. (The Rapier A/B overlay this page was born
 * with retired together with Rapier once crash feel was signed off.)
 *
 * Serve with: npx vite   then open http://localhost:5173/engine/bench/harness.html
 */

import {
  SCENARIOS,
  createEngineScenarioRun,
  scenarioByName,
  type EngineScenarioRun,
  type Scenario,
} from '../testing/scenarios';
import {DEFAULT_CONTACT_TUNING, type ContactTuning} from '../solvers/vehicle-contact';
import {findBody} from '../world/world-state';
const DT = 1 / 60;

// --- UI state ---------------------------------------------------------------

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const context = canvas.getContext('2d')!;
const scenarioSelect = document.getElementById('scenario') as HTMLSelectElement;
const description = document.getElementById('description')!;
const tickline = document.getElementById('tickline')!;
const playpause = document.getElementById('playpause') as HTMLButtonElement;
const trailsBox = document.getElementById('trails') as HTMLInputElement;
const speedSelect = document.getElementById('speed') as HTMLSelectElement;

for (const scenario of SCENARIOS) {
  const option = document.createElement('option');
  option.value = scenario.name;
  option.textContent = scenario.title;
  scenarioSelect.append(option);
}

const tuning: ContactTuning = {...DEFAULT_CONTACT_TUNING};
const SLIDER_SPECS: Array<{key: keyof ContactTuning; min: number; max: number; step: number}> = [
  {key: 'restitutionScale', min: 0, max: 3, step: 0.05},
  {key: 'restitutionThreshold', min: 0, max: 120, step: 1},
  {key: 'frictionScale', min: 0, max: 3, step: 0.05},
  {key: 'positionalBeta', min: 0, max: 1, step: 0.02},
  {key: 'slop', min: 0, max: 4, step: 0.1},
  {key: 'inertiaScale', min: 0.1, max: 4, step: 0.05},
  {key: 'spinResponse', min: 0, max: 4, step: 0.05},
  {key: 'iterations', min: 1, max: 24, step: 1},
  {key: 'maxSubsteps', min: 1, max: 8, step: 1},
];

const slidersHost = document.getElementById('sliders')!;
const sliderInputs = new Map<keyof ContactTuning, HTMLInputElement>();
for (const spec of SLIDER_SPECS) {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const label = document.createElement('label');
  label.textContent = spec.key;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(tuning[spec.key]);
  const output = document.createElement('output');
  output.textContent = String(tuning[spec.key]);
  input.addEventListener('input', () => {
    tuning[spec.key] = Number(input.value);
    output.textContent = input.value;
  });
  wrap.append(label, input, output);
  slidersHost.append(wrap);
  sliderInputs.set(spec.key, input);
}

function syncSliders(): void {
  for (const spec of SLIDER_SPECS) {
    const input = sliderInputs.get(spec.key)!;
    input.value = String(tuning[spec.key]);
    (input.nextElementSibling as HTMLOutputElement).textContent = input.value;
  }
}

document.getElementById('resetTuning')!.addEventListener('click', () => {
  Object.assign(tuning, DEFAULT_CONTACT_TUNING);
  syncSliders();
});
document.getElementById('copyTuning')!.addEventListener('click', () => {
  void navigator.clipboard.writeText(JSON.stringify(tuning, null, 2));
});

// --- Run management ---------------------------------------------------------

let scenario: Scenario = SCENARIOS[0];
let engineRun: EngineScenarioRun;
let playing = true;
let finished = false;
const engineTrails = new Map<string, number[]>();

function restart(): void {
  scenario = scenarioByName(scenarioSelect.value || SCENARIOS[0].name);
  description.textContent = scenario.description;
  engineRun = createEngineScenarioRun(scenario);
  engineTrails.clear();
  finished = false;
  canvas.width = scenario.geometry.width * scenario.geometry.tileWidth;
  canvas.height = scenario.geometry.height * scenario.geometry.tileHeight;
}

scenarioSelect.addEventListener('change', restart);
document.getElementById('restart')!.addEventListener('click', restart);
playpause.addEventListener('click', () => {
  playing = !playing;
  playpause.textContent = playing ? 'Pause' : 'Play';
});
document.getElementById('steponce')!.addEventListener('click', () => {
  playing = false;
  playpause.textContent = 'Play';
  stepOnce();
});

function pushTrail(trails: Map<string, number[]>, id: string, x: number, y: number): void {
  let trail = trails.get(id);
  if (!trail) trails.set(id, (trail = []));
  trail.push(x, y);
  if (trail.length > 2400) trail.splice(0, trail.length - 2400);
}

function stepOnce(): void {
  if (engineRun.tick >= scenario.ticks) {
    finished = true;
    return;
  }
  engineRun.step(tuning);
  for (const vehicle of scenario.vehicles) {
    const body = findBody(engineRun.state, vehicle.id);
    if (body) pushTrail(engineTrails, vehicle.id, body.state.x, body.state.y);
  }
}

// --- Rendering --------------------------------------------------------------

function drawBox(x: number, y: number, angle: number, halfLength: number, halfWidth: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.beginPath();
  context.rect(-halfLength, -halfWidth, halfLength * 2, halfWidth * 2);
  // Nose marker so spin direction is readable.
  context.moveTo(halfLength * 0.4, -halfWidth);
  context.lineTo(halfLength, 0);
  context.lineTo(halfLength * 0.4, halfWidth);
  context.restore();
}

function render(): void {
  const {geometry} = scenario;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#26262e';
  for (let row = 0; row < geometry.height; row++) {
    for (let col = 0; col < geometry.width; col++) {
      if (geometry.collisions[row * geometry.width + col]) {
        context.fillRect(col * geometry.tileWidth, row * geometry.tileHeight, geometry.tileWidth, geometry.tileHeight);
      }
    }
  }

  if (trailsBox.checked) {
    {
      context.strokeStyle = 'rgba(77,163,255,0.5)';
      context.lineWidth = 1.5;
      for (const trail of engineTrails.values()) {
        context.beginPath();
        for (let i = 0; i < trail.length; i += 2) {
          if (i === 0) context.moveTo(trail[0], trail[1]);
          else context.lineTo(trail[i], trail[i + 1]);
        }
        context.stroke();
      }
    }
  }

  // Engine bodies: filled.
  for (const body of engineRun.state.bodies) {
    const isVehicle = body.shape.kind === 'box';
    context.fillStyle = isVehicle ? 'rgba(77,163,255,0.75)' : 'rgba(120,220,140,0.8)';
    context.strokeStyle = isVehicle ? '#8fc4ff' : '#a8f0b8';
    context.lineWidth = 1.5;
    context.beginPath();
    if (body.shape.kind === 'box') {
      drawBox(body.state.x, body.state.y, body.state.angle, body.shape.halfLength, body.shape.halfWidth);
    } else {
      context.arc(body.state.x, body.state.y, body.shape.radius, 0, Math.PI * 2);
    }
    context.fill();
    context.stroke();
  }

  tickline.textContent = `tick ${engineRun.tick} / ${scenario.ticks}${finished ? ' — done (Restart to rerun)' : ''}`;

}

// --- Main loop --------------------------------------------------------------

let accumulator = 0;
let last = performance.now();

function frame(now: number): void {
  const speed = Number(speedSelect.value);
  accumulator += Math.min(0.1, (now - last) / 1000) * speed;
  last = now;
  if (playing) {
    while (accumulator >= DT) {
      accumulator -= DT;
      stepOnce();
    }
  } else {
    accumulator = 0;
  }
  render();
  requestAnimationFrame(frame);
}

scenarioSelect.value = SCENARIOS[0].name;
restart();
requestAnimationFrame(frame);

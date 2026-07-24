import {spawn} from 'node:child_process';
import {
  copyFile,
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {
  VEHICLE_SOURCE_FRAMES,
  type VehicleBuildReport,
  type VehicleCandidate,
  type VehicleSourceFrame,
  type VehicleWorkshopCatalogResponse,
  type VehicleWorkshopManifest
} from '../../shared/content/vehicle-workshop.ts';
import {
  VEHICLE_SOURCE_ROOT,
  loadVehicleManifests,
  parseVehicleManifest
} from '../../src/tools/vehicle-pipeline/vehicle-manifest.ts';
import {
  vehiclePublicUrl,
  vehicleWorkshopRecord
} from '../../src/tools/vehicle-pipeline/vehicle-assets.ts';

const IMAGE_MODEL = process.env.VEHICLE_IMAGE_MODEL?.trim() || 'gpt-image-2';
const VEHICLE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export class VehicleWorkshopError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export function vehicleWorkshopWritable(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.VEHICLE_WORKSHOP_ENABLED === '1';
}

export function requireVehicleWorkshop(): void {
  if (!vehicleWorkshopWritable()) {
    throw new VehicleWorkshopError('Vehicle Workshop is disabled in production.', 403);
  }
}

export async function vehicleWorkshopCatalog(): Promise<VehicleWorkshopCatalogResponse> {
  requireVehicleWorkshop();
  const manifests = await loadVehicleManifests();
  return {
    generatorConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    writable: true,
    vehicles: await Promise.all(
      manifests
        .sort((a, b) => a.presentation.atlasRow - b.presentation.atlasRow)
        .map((manifest) => vehicleWorkshopRecord(manifest))
    )
  };
}

export async function createVehicleDraft(input: {
  id: string;
  label: string;
  prompt: string;
}): Promise<VehicleWorkshopManifest> {
  requireVehicleWorkshop();
  const id = input.id.trim().toLowerCase();
  if (!VEHICLE_ID_PATTERN.test(id)) {
    throw new VehicleWorkshopError('Vehicle id must use lowercase letters, numbers, and hyphens.');
  }
  const manifests = await loadVehicleManifests();
  if (manifests.some((manifest) => manifest.id === id)) {
    throw new VehicleWorkshopError(`Vehicle "${id}" already exists.`, 409);
  }
  const template = manifests.find((manifest) => manifest.id === 'sedan') ?? manifests[0];
  if (!template) throw new VehicleWorkshopError('No vehicle template is available.', 500);
  const nextRow = Math.max(-1, ...manifests.map((manifest) => manifest.presentation.atlasRow)) + 1;
  const manifest: VehicleWorkshopManifest = {
    ...structuredClone(template),
    id,
    label: input.label.trim() || id,
    status: 'draft',
    class: 'civilian',
    presentation: {
      ...structuredClone(template.presentation),
      atlasRow: nextRow,
      emergencyLights: false,
      offsets: Object.fromEntries(
        VEHICLE_SOURCE_FRAMES.map((frame) => [frame, {x: 0.5, y: 0.5}])
      ) as VehicleWorkshopManifest['presentation']['offsets']
    },
    population: {parked: true, ambientTraffic: true, weight: 1},
    generation: {
      prompt: input.prompt.trim(),
      model: IMAGE_MODEL
    }
  };
  await writeVehicleManifest(manifest);
  await mkdir(path.join(vehicleDirectory(id), 'candidates', 'raw'), {recursive: true});
  return manifest;
}

export async function updateVehicleManifest(
  vehicleId: string,
  raw: unknown
): Promise<VehicleWorkshopManifest> {
  requireVehicleWorkshop();
  const manifest = parseVehicleManifest(raw, `${vehicleId}/vehicle.json`);
  if (manifest.id !== vehicleId) throw new VehicleWorkshopError('Vehicle id cannot be changed.');
  const manifests = await loadVehicleManifests();
  const previous = manifests.find((item) => item.id === vehicleId);
  if (!previous) throw new VehicleWorkshopError(`Vehicle "${vehicleId}" does not exist.`, 404);
  return writeNormalizedVehicleManifests(manifests, manifest, previous.status);
}

export async function generateVehicleFrames(
  vehicleId: string,
  frames: VehicleSourceFrame[],
  promptOverride?: string
): Promise<VehicleCandidate[]> {
  requireVehicleWorkshop();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new VehicleWorkshopError('OPENAI_API_KEY is not configured.', 503);
  const manifest = await vehicleManifest(vehicleId);
  const prompt = promptOverride?.trim() || manifest.generation.prompt.trim();
  if (!prompt) throw new VehicleWorkshopError('Write a vehicle brief before generating.');
  const uniqueFrames = [...new Set(frames)];
  if (!uniqueFrames.length || uniqueFrames.some((frame) => !VEHICLE_SOURCE_FRAMES.includes(frame))) {
    throw new VehicleWorkshopError('No valid vehicle frames requested.');
  }
  if (uniqueFrames.some((frame) => frame !== 'closed')) {
    await assertSourceFrame(vehicleId, 'closed');
  }
  const candidates: VehicleCandidate[] = [];
  for (const frame of uniqueFrames) {
    candidates.push(await generateVehicleFrame(apiKey, manifest, frame, prompt));
  }
  manifest.generation = {
    prompt,
    model: IMAGE_MODEL,
    updatedAt: new Date().toISOString()
  };
  await writeVehicleManifest(manifest);
  return candidates;
}

export async function acceptVehicleCandidate(
  vehicleId: string,
  candidateId: string,
  frame: VehicleSourceFrame
): Promise<string> {
  requireVehicleWorkshop();
  await assertVehicleExists(vehicleId);
  if (!/^\d+-(closed|front-left|front-right|rear-left|rear-right)\.png$/.test(candidateId)) {
    throw new VehicleWorkshopError('Invalid candidate id.');
  }
  const source = path.join(vehicleDirectory(vehicleId), 'candidates', candidateId);
  const target = path.join(vehicleDirectory(vehicleId), `${frame}.png`);
  await copyFile(source, target);
  return vehiclePublicUrl(vehicleId, `${frame}.png`);
}

export async function installUploadedVehicleFrame(
  vehicleId: string,
  frame: VehicleSourceFrame,
  bytes: Buffer
): Promise<string> {
  requireVehicleWorkshop();
  await assertVehicleExists(vehicleId);
  if (!VEHICLE_SOURCE_FRAMES.includes(frame)) throw new VehicleWorkshopError('Invalid vehicle frame.');
  const stamp = Date.now();
  const rawPath = path.join(vehicleDirectory(vehicleId), 'candidates', 'raw', `${stamp}-${frame}-upload.png`);
  const candidatePath = path.join(vehicleDirectory(vehicleId), 'candidates', `${stamp}-${frame}.png`);
  await mkdir(path.dirname(rawPath), {recursive: true});
  await writeFile(rawPath, bytes);
  await processVehicleSprite(rawPath, candidatePath);
  return vehiclePublicUrl(vehicleId, `candidates/${stamp}-${frame}.png`);
}

export async function duplicateClosedVehicleDoors(vehicleId: string): Promise<void> {
  requireVehicleWorkshop();
  await assertSourceFrame(vehicleId, 'closed');
  for (const frame of VEHICLE_SOURCE_FRAMES) {
    if (frame !== 'closed') {
      await copyFile(
        path.join(vehicleDirectory(vehicleId), 'closed.png'),
        path.join(vehicleDirectory(vehicleId), `${frame}.png`)
      );
    }
  }
}

export async function buildVehicles(): Promise<VehicleBuildReport> {
  requireVehicleWorkshop();
  const output = await runCommand('npm', ['run', '--silent', 'vehicles:build']);
  try {
    return JSON.parse(output) as VehicleBuildReport;
  } catch {
    throw new VehicleWorkshopError(`Vehicle compiler returned invalid output:\n${output}`, 500);
  }
}

async function generateVehicleFrame(
  apiKey: string,
  manifest: VehicleWorkshopManifest,
  frame: VehicleSourceFrame,
  brief: string
): Promise<VehicleCandidate> {
  const stamp = Date.now();
  const rawPath = path.join(vehicleDirectory(manifest.id), 'candidates', 'raw', `${stamp}-${frame}.png`);
  const candidatePath = path.join(vehicleDirectory(manifest.id), 'candidates', `${stamp}-${frame}.png`);
  await mkdir(path.dirname(rawPath), {recursive: true});
  const prompt = vehicleGenerationPrompt(brief, frame);
  const image = frame === 'closed'
    ? await requestGeneratedImage(apiKey, prompt)
    : await requestEditedImage(
      apiKey,
      prompt,
      await readFile(path.join(vehicleDirectory(manifest.id), 'closed.png'))
    );
  await writeFile(rawPath, image);
  await processVehicleSprite(rawPath, candidatePath);
  return {
    id: path.basename(candidatePath),
    frame,
    url: vehiclePublicUrl(manifest.id, `candidates/${path.basename(candidatePath)}`),
    createdAt: new Date(stamp).toISOString()
  };
}

function vehicleGenerationPrompt(brief: string, frame: VehicleSourceFrame): string {
  const common = [
    'Create exactly one production-ready top-down 2D pixel-art civilian vehicle sprite for NOCK0.',
    'Direct overhead view with a slight readable roof surface, GTA-style top-down proportions.',
    'The vehicle is centered vertically with its nose pointing straight up.',
    'Use a 100% solid flat #FF00FF magenta background with no gradient, texture, road, shadow, text, logo, scenery, border, or UI.',
    'Keep the complete vehicle inside the central 70% of the square image with generous magenta padding.',
    'Crisp dark outline, readable windshield, roof, hood, trunk, lights, and wheels.',
    'One vehicle only. No humans. No detached props. Do not draw frame guides.'
  ];
  const frameInstruction = frame === 'closed'
    ? 'All doors are fully closed.'
    : `Preserve the exact vehicle identity, silhouette, paint, camera, scale, center, and orientation from the reference. Open only the ${frame.replace('-', ' ')} door. Every other door remains closed.`;
  return `${common.join(' ')} ${frameInstruction} Vehicle brief: ${brief}`;
}

async function requestGeneratedImage(apiKey: string, prompt: string): Promise<Buffer> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
      n: 1
    })
  });
  return imageResponseBuffer(response);
}

async function requestEditedImage(apiKey: string, prompt: string, reference: Buffer): Promise<Buffer> {
  const body = new FormData();
  const referenceBytes = Uint8Array.from(reference);
  body.append('model', IMAGE_MODEL);
  body.append('prompt', prompt);
  body.append('size', '1024x1024');
  body.append('quality', 'medium');
  body.append('output_format', 'png');
  body.append('image[]', new Blob([referenceBytes], {type: 'image/png'}), 'closed.png');
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {Authorization: `Bearer ${apiKey}`},
    body
  });
  return imageResponseBuffer(response);
}

async function imageResponseBuffer(response: Response): Promise<Buffer> {
  const payload = await response.json() as {
    data?: Array<{b64_json?: string}>;
    error?: {message?: string};
  };
  if (!response.ok) {
    throw new VehicleWorkshopError(payload.error?.message || `Image generation failed (${response.status}).`, 502);
  }
  const base64 = payload.data?.[0]?.b64_json;
  if (!base64) throw new VehicleWorkshopError('Image generation returned no image.', 502);
  return Buffer.from(base64, 'base64');
}

async function processVehicleSprite(input: string, output: string): Promise<void> {
  await runCommand('python3', [
    'scripts/process-vehicle-sprite.py',
    '--input',
    input,
    '--output',
    output
  ]);
}

async function vehicleManifest(vehicleId: string): Promise<VehicleWorkshopManifest> {
  const manifestPath = path.join(vehicleDirectory(vehicleId), 'vehicle.json');
  try {
    return parseVehicleManifest(JSON.parse(await readFile(manifestPath, 'utf8')), manifestPath);
  } catch (error) {
    if (isMissingFile(error)) throw new VehicleWorkshopError(`Vehicle "${vehicleId}" does not exist.`, 404);
    throw error;
  }
}

async function writeVehicleManifest(manifest: VehicleWorkshopManifest): Promise<void> {
  const directory = vehicleDirectory(manifest.id);
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, 'vehicle.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeNormalizedVehicleManifests(
  current: VehicleWorkshopManifest[],
  replacement: VehicleWorkshopManifest,
  previousStatus: VehicleWorkshopManifest['status']
): Promise<VehicleWorkshopManifest> {
  const combined = current
    .filter((manifest) => manifest.id !== replacement.id)
    .concat(replacement);
  const newlyReady = previousStatus !== 'ready' && replacement.status === 'ready';
  const ready = combined
    .filter((manifest) => manifest.status === 'ready')
    .sort((a, b) => {
      if (newlyReady && a.id === replacement.id) return 1;
      if (newlyReady && b.id === replacement.id) return -1;
      return a.presentation.atlasRow - b.presentation.atlasRow;
    });
  const drafts = combined
    .filter((manifest) => manifest.status === 'draft')
    .sort((a, b) => a.presentation.atlasRow - b.presentation.atlasRow);
  const ordered = [...ready, ...drafts].map((manifest, atlasRow) => ({
    ...manifest,
    presentation: {...manifest.presentation, atlasRow}
  }));
  await Promise.all(ordered.map((manifest) => writeVehicleManifest(manifest)));
  return ordered.find((manifest) => manifest.id === replacement.id) ?? replacement;
}

async function assertVehicleExists(vehicleId: string): Promise<void> {
  await vehicleManifest(vehicleId);
}

async function assertSourceFrame(vehicleId: string, frame: VehicleSourceFrame): Promise<void> {
  try {
    await readFile(path.join(vehicleDirectory(vehicleId), `${frame}.png`));
  } catch (error) {
    if (isMissingFile(error)) throw new VehicleWorkshopError(`Accept a ${frame} frame first.`);
    throw error;
  }
}

function vehicleDirectory(vehicleId: string): string {
  if (!VEHICLE_ID_PATTERN.test(vehicleId)) throw new VehicleWorkshopError('Invalid vehicle id.');
  return path.join(VEHICLE_SOURCE_ROOT, vehicleId);
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new VehicleWorkshopError(stderr.trim() || stdout.trim() || `${command} exited ${code}.`, 500));
    });
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

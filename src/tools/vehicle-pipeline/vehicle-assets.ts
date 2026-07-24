import {access, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {
  VEHICLE_SOURCE_FRAMES,
  type VehicleCandidate,
  type VehicleFrameState,
  type VehicleSourceFrame,
  type VehicleWorkshopManifest,
  type VehicleWorkshopRecord
} from '../../../shared/content/vehicle-workshop.ts';
import {VEHICLE_SOURCE_ROOT} from './vehicle-manifest.ts';

export async function vehicleWorkshopRecord(
  manifest: VehicleWorkshopManifest,
  sourceRoot = VEHICLE_SOURCE_ROOT
): Promise<VehicleWorkshopRecord> {
  const vehicleDirectory = path.join(sourceRoot, manifest.id);
  const frames = await Promise.all(VEHICLE_SOURCE_FRAMES.map(async (name): Promise<VehicleFrameState> => {
    const exists = await fileExists(path.join(vehicleDirectory, `${name}.png`));
    return {
      name,
      exists,
      ...(exists ? {url: vehiclePublicUrl(manifest.id, `${name}.png`)} : {})
    };
  }));
  const candidates = await listVehicleCandidates(manifest.id, sourceRoot);
  const issues: string[] = [];
  if (!manifest.generation.prompt.trim()) issues.push('Generation brief is empty.');
  for (const frame of frames) {
    if (!frame.exists) issues.push(`Missing ${frame.name}.png.`);
  }
  return {manifest, frames, candidates, issues};
}

export async function listVehicleCandidates(
  vehicleId: string,
  sourceRoot = VEHICLE_SOURCE_ROOT
): Promise<VehicleCandidate[]> {
  const directory = path.join(sourceRoot, vehicleId, 'candidates');
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  const candidates: VehicleCandidate[] = [];
  for (const file of files) {
    const match = /^(?<stamp>\d+)-(?<frame>closed|front-left|front-right|rear-left|rear-right)\.png$/.exec(file);
    if (!match?.groups) continue;
    candidates.push({
      id: file,
      frame: match.groups.frame as VehicleSourceFrame,
      url: vehiclePublicUrl(vehicleId, `candidates/${file}`),
      createdAt: new Date(Number(match.groups.stamp)).toISOString()
    });
  }
  return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function validatePngFrame(filePath: string): Promise<string[]> {
  const issues: string[] = [];
  let png: Buffer;
  try {
    png = await readFile(filePath);
  } catch (error) {
    return [isMissingFile(error) ? `Missing ${path.basename(filePath)}.` : String(error)];
  }
  if (png.length < 26 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
    return [`${path.basename(filePath)} is not a PNG.`];
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png[25];
  if (width !== 96 || height !== 96) issues.push(`${path.basename(filePath)} must be 96x96; got ${width}x${height}.`);
  if (colorType !== 6) issues.push(`${path.basename(filePath)} must be RGBA.`);
  return issues;
}

export function vehiclePublicUrl(vehicleId: string, file: string): string {
  return `/assets/custom/vehicles/${encodeURIComponent(vehicleId)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

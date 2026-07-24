import type {DistrictNetworkState, NetworkPlayer, NetworkVehicle} from '../types.ts';
import {AudioBus} from './audio-bus.ts';
import {projectPositionalAudio, type AudioListenerPosition} from './positional-audio-policy.ts';
import {VehicleSkidAudio} from './vehicle-skid-audio.ts';
import {vehicleSkidAudioPresentation} from './vehicle-skid-audio-policy.ts';

interface SirenVoice {
  source?: AudioBufferSourceNode;
  oscillator?: OscillatorNode;
  gain: GainNode;
  panner?: StereoPannerNode;
  timer?: number;
}

const SIREN_MAX_DISTANCE = 1_700;
const SIREN_BASE_GAIN = 0.42;
const SIREN_LOW_HZ = 650;
const SIREN_HIGH_HZ = 980;
const SIREN_STEP_MS = 430;
const SIREN_SAMPLE = '/assets/audio/sfx/siren.wav';
const SKID_MAX_DISTANCE = 1_150;
const SKID_BASE_GAIN = 0.58;
const MAXIMUM_SKID_VOICES = 6;

export class VehicleAudioSystem {
  private readonly bus = new AudioBus();
  private readonly skids = new Map<string, VehicleSkidAudio>();
  private readonly sirens = new Map<string, SirenVoice>();
  private sirenBuffer?: Promise<AudioBuffer | undefined>;
  private listener?: AudioListenerPosition;

  synchronize(
    player: NetworkPlayer | undefined,
    localVehicle: NetworkVehicle | undefined,
    vehicles?: Map<string, NetworkVehicle>
  ): void {
    this.listener = listenerFor(player, localVehicle);
    if (!this.listener || !vehicles) {
      this.stopAll();
      return;
    }
    const activeSirens = new Set<string>();
    const activeSkids = new Set<string>();
    const skidCandidates: Array<{
      vehicleId: string;
      input: {angle: number; linvelX: number; linvelY: number; destroyed: boolean};
      volume: number;
      pan: number;
      score: number;
    }> = [];
    vehicles.forEach((vehicle, vehicleId) => {
      const skidInput = {
        angle: vehicle.angle,
        linvelX: vehicle.linvelX ?? Math.cos(vehicle.angle) * vehicle.speed,
        linvelY: vehicle.linvelY ?? Math.sin(vehicle.angle) * vehicle.speed,
        destroyed: vehicle.destroyed
      };
      const skidPresentation = vehicleSkidAudioPresentation(skidInput);
      if (skidPresentation.active) {
        const skidProjection = projectPositionalAudio(
          this.listener as AudioListenerPosition,
          {x: vehicle.x, y: vehicle.y, maxDistance: SKID_MAX_DISTANCE},
          SKID_BASE_GAIN
        );
        if (skidProjection.gain > 0.006) {
          skidCandidates.push({
            vehicleId,
            input: skidInput,
            volume: skidProjection.gain,
            pan: skidProjection.pan,
            score: skidProjection.gain * skidPresentation.intensity
          });
        }
      }

      if (vehicle.kind !== 'police' || !vehicle.siren || vehicle.destroyed) return;
      const sirenProjection = projectPositionalAudio(
        this.listener as AudioListenerPosition,
        {x: vehicle.x, y: vehicle.y, maxDistance: SIREN_MAX_DISTANCE},
        SIREN_BASE_GAIN
      );
      if (sirenProjection.gain <= 0.006) return;
      activeSirens.add(vehicleId);
      this.updateSiren(vehicleId, sirenProjection.gain, sirenProjection.pan);
    });
    skidCandidates.sort((left, right) => right.score - left.score);
    for (const candidate of skidCandidates.slice(0, MAXIMUM_SKID_VOICES)) {
      activeSkids.add(candidate.vehicleId);
      let skid = this.skids.get(candidate.vehicleId);
      if (!skid) {
        skid = new VehicleSkidAudio(this.bus);
        this.skids.set(candidate.vehicleId, skid);
      }
      skid.synchronize(candidate.input, {
        volume: candidate.volume,
        pan: candidate.pan
      });
    }
    for (const vehicleId of this.sirens.keys()) {
      if (!activeSirens.has(vehicleId)) this.stopSiren(vehicleId);
    }
    for (const vehicleId of this.skids.keys()) {
      if (!activeSkids.has(vehicleId)) this.stopSkid(vehicleId);
    }
  }

  destroy(): void {
    this.stopAll();
    this.bus.destroy();
  }

  private updateSiren(vehicleId: string, volume: number, pan: number): void {
    const existing = this.sirens.get(vehicleId);
    if (existing) {
      this.ramp(existing.gain, volume);
      if (existing.panner) existing.panner.pan.setTargetAtTime(pan, this.bus.now(), 0.08);
      return;
    }
    const gain = this.bus.createGain();
    const output = this.bus.bus('sfx');
    if (!gain || !output) return;
    const panner = this.bus.createStereoPanner();
    gain.gain.value = 0.0001;
    if (panner) panner.pan.value = pan;
    gain.connect(panner ?? output);
    if (panner) panner.connect(output);
    const voice: SirenVoice = {gain, panner};
    this.sirens.set(vehicleId, voice);
    void this.startSampleSiren(vehicleId, voice);
    this.ramp(gain, volume);
  }

  private stopSiren(vehicleId: string): void {
    const voice = this.sirens.get(vehicleId);
    if (!voice) return;
    if (voice.timer) window.clearInterval(voice.timer);
    const now = this.bus.now();
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, 0.08);
    window.setTimeout(() => {
      try {
        voice.source?.stop();
      } catch {
        // The source can already be stopped during rapid room teardown.
      }
      try {
        voice.oscillator?.stop();
      } catch {
        // The oscillator can already be stopped during rapid room teardown.
      }
      voice.source?.disconnect();
      voice.oscillator?.disconnect();
      voice.gain.disconnect();
      voice.panner?.disconnect();
    }, 220);
    this.sirens.delete(vehicleId);
  }

  private stopAll(): void {
    for (const vehicleId of [...this.sirens.keys()]) this.stopSiren(vehicleId);
    for (const vehicleId of [...this.skids.keys()]) this.stopSkid(vehicleId);
  }

  private stopSkid(vehicleId: string, immediate = false): void {
    const skid = this.skids.get(vehicleId);
    if (!skid) return;
    if (immediate) skid.destroy();
    else skid.synchronize(undefined);
    this.skids.delete(vehicleId);
  }

  private ramp(gain: GainNode, volume: number): void {
    const now = this.bus.now();
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(Math.max(0.0001, volume), now, 0.08);
  }

  private async startSampleSiren(vehicleId: string, voice: SirenVoice): Promise<void> {
    const buffer = await this.loadSiren();
    if (this.sirens.get(vehicleId) !== voice) return;
    if (!buffer) {
      this.startSyntheticSiren(voice);
      return;
    }
    const source = this.bus.createBufferSource();
    if (!source) {
      this.startSyntheticSiren(voice);
      return;
    }
    source.buffer = buffer;
    source.loop = true;
    source.connect(voice.gain);
    source.start(this.bus.now());
    voice.source = source;
  }

  private loadSiren(): Promise<AudioBuffer | undefined> {
    this.sirenBuffer ??= this.bus.decodeAudio(SIREN_SAMPLE).catch(() => undefined);
    return this.sirenBuffer;
  }

  private startSyntheticSiren(voice: SirenVoice): void {
    const oscillator = this.bus.createOscillator();
    if (!oscillator) return;
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = SIREN_LOW_HZ;
    oscillator.connect(voice.gain);
    oscillator.start(this.bus.now());
    let high = false;
    voice.timer = window.setInterval(() => {
      high = !high;
      oscillator.frequency.setTargetAtTime(high ? SIREN_HIGH_HZ : SIREN_LOW_HZ, this.bus.now(), 0.035);
    }, SIREN_STEP_MS);
    voice.oscillator = oscillator;
  }
}

function listenerFor(
  player: NetworkPlayer | undefined,
  vehicle: NetworkVehicle | undefined
): AudioListenerPosition | undefined {
  if (!player?.alive) return undefined;
  if (player.vehicleId && vehicle && !vehicle.destroyed) {
    return {x: vehicle.x, y: vehicle.y, angle: vehicle.angle};
  }
  return {x: player.x, y: player.y, angle: player.angle};
}

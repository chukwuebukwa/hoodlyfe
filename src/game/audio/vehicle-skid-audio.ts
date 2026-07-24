import type {AudioBus} from './audio-bus.ts';
import {
  vehicleSkidAudioPresentation,
  type VehicleSkidAudioInput
} from './vehicle-skid-audio-policy.ts';

const SKID_SAMPLES = [
  '/assets/audio/sfx/skids/drift-01.wav',
  '/assets/audio/sfx/skids/drift-02.wav',
  '/assets/audio/sfx/skids/pavement-02.wav'
] as const;
const SAMPLE_ATTACK_SECONDS = 0.08;
const SAMPLE_CROSSFADE_SECONDS = 0.2;
const STOP_FADE_SECONDS = 0.12;
const BUFFER_CACHE = new WeakMap<AudioBus, Promise<Array<AudioBuffer | undefined>>>();

interface PlayingSample {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface SkidVoice {
  output: GainNode;
  panner?: StereoPannerNode;
  samples: Set<PlayingSample>;
  timer?: number;
  intensity: number;
  stopped: boolean;
}

export class VehicleSkidAudio {
  private voice?: SkidVoice;
  private startToken = 0;
  private driftSampleCursor = 0;

  constructor(private readonly bus: AudioBus) {}

  synchronize(
    input: VehicleSkidAudioInput | undefined,
    options: {volume?: number; pan?: number} = {}
  ): void {
    const presentation = input ? vehicleSkidAudioPresentation(input) : undefined;
    if (!presentation?.active) {
      this.stop();
      return;
    }
    const volume = Math.max(0, Math.min(1, options.volume ?? 1));
    const targetGain = Math.max(0.0001, presentation.intensity * volume);
    if (!this.voice) void this.start(targetGain, options.pan ?? 0, presentation.intensity);
    const voice = this.voice;
    if (!voice) return;
    voice.intensity = presentation.intensity;
    const now = this.bus.now();
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setTargetAtTime(targetGain, now, 0.07);
    voice.panner?.pan.setTargetAtTime(
      Math.max(-1, Math.min(1, options.pan ?? 0)),
      now,
      0.08
    );
  }

  destroy(): void {
    this.stop(true);
  }

  private async start(
    targetGain: number,
    pan: number,
    intensity: number
  ): Promise<void> {
    const token = ++this.startToken;
    const buffers = await this.loadBuffers();
    if (token !== this.startToken || this.voice) return;
    if (!buffers.some(Boolean)) return;
    const output = this.bus.bus('sfx');
    const gain = this.bus.createGain();
    if (!output || !gain) return;
    const panner = this.bus.createStereoPanner();
    gain.gain.value = 0.0001;
    if (panner) panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner ?? output);
    if (panner) panner.connect(output);
    const voice: SkidVoice = {
      output: gain,
      panner,
      samples: new Set(),
      intensity,
      stopped: false
    };
    this.voice = voice;
    gain.gain.setTargetAtTime(targetGain, this.bus.now(), 0.07);
    this.scheduleSample(voice, buffers, this.bus.now() + 0.01);
  }

  private scheduleSample(
    voice: SkidVoice,
    buffers: Array<AudioBuffer | undefined>,
    startAt: number
  ): void {
    if (voice.stopped || this.voice !== voice) return;
    const actualStart = Math.max(startAt, this.bus.now() + 0.01);
    const buffer = this.selectBuffer(buffers, voice.intensity);
    const source = this.bus.createBufferSource();
    const sampleGain = this.bus.createGain();
    if (!buffer || !source || !sampleGain) return;
    const playbackRate = 0.9 + voice.intensity * 0.18;
    const duration = buffer.duration / playbackRate;
    const endAt = actualStart + duration;
    const fadeOutAt = Math.max(
      actualStart + SAMPLE_ATTACK_SECONDS,
      endAt - SAMPLE_CROSSFADE_SECONDS
    );
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    sampleGain.gain.setValueAtTime(0.0001, actualStart);
    sampleGain.gain.linearRampToValueAtTime(1, actualStart + SAMPLE_ATTACK_SECONDS);
    sampleGain.gain.setValueAtTime(1, fadeOutAt);
    sampleGain.gain.linearRampToValueAtTime(0.0001, endAt);
    source.connect(sampleGain);
    sampleGain.connect(voice.output);
    const playing: PlayingSample = {source, gain: sampleGain};
    voice.samples.add(playing);
    source.onended = () => {
      voice.samples.delete(playing);
      source.disconnect();
      sampleGain.disconnect();
    };
    source.start(actualStart);

    const nextStart = Math.max(actualStart + 0.1, endAt - SAMPLE_CROSSFADE_SECONDS);
    const scheduleInMs = Math.max(20, (nextStart - this.bus.now() - 0.08) * 1000);
    voice.timer = window.setTimeout(() => {
      voice.timer = undefined;
      this.scheduleSample(voice, buffers, nextStart);
    }, scheduleInMs);
  }

  private selectBuffer(
    buffers: Array<AudioBuffer | undefined>,
    intensity: number
  ): AudioBuffer | undefined {
    if (intensity < 0.42 && buffers[2]) return buffers[2];
    const driftBuffers = [buffers[0], buffers[1]].filter(
      (buffer): buffer is AudioBuffer => Boolean(buffer)
    );
    if (driftBuffers.length > 0) {
      return driftBuffers[this.driftSampleCursor++ % driftBuffers.length];
    }
    return buffers.find((buffer): buffer is AudioBuffer => Boolean(buffer));
  }

  private stop(immediate = false): void {
    this.startToken += 1;
    const voice = this.voice;
    if (!voice) return;
    this.voice = undefined;
    voice.stopped = true;
    if (voice.timer) window.clearTimeout(voice.timer);
    const now = this.bus.now();
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setTargetAtTime(0.0001, now, immediate ? 0.005 : STOP_FADE_SECONDS);
    window.setTimeout(() => {
      for (const sample of voice.samples) {
        try {
          sample.source.stop();
        } catch {
          // A source can finish naturally before teardown.
        }
        sample.source.disconnect();
        sample.gain.disconnect();
      }
      voice.samples.clear();
      voice.output.disconnect();
      voice.panner?.disconnect();
    }, immediate ? 20 : 360);
  }

  private loadBuffers(): Promise<Array<AudioBuffer | undefined>> {
    const cached = BUFFER_CACHE.get(this.bus);
    if (cached) return cached;
    const loading = Promise.all(
      SKID_SAMPLES.map((sample) => this.bus.decodeAudio(sample).catch(() => undefined))
    );
    BUFFER_CACHE.set(this.bus, loading);
    return loading;
  }
}

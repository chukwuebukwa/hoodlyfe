import type {Room} from 'colyseus.js';
import {
  AUDIO_EVENTS_MESSAGE,
  type AudioEventPayload,
  type AudioEventsMessage
} from '../../../shared/protocol/audio-events.ts';
import type {DistrictNetworkState, NetworkPlayer, NetworkVehicle} from '../types.ts';
import {AudioBus} from './audio-bus.ts';
import {projectPositionalAudio, type AudioListenerPosition} from './positional-audio-policy.ts';

const EVENT_TTL_MS = 2_000;

const SAMPLES = {
  pistol: '/assets/audio/gta2/sfx/pistol.wav',
  smg: '/assets/audio/gta2/sfx/smg.wav',
  shotgun: '/assets/audio/gta2/sfx/shotgun.wav',
  rocket: '/assets/audio/gta2/sfx/rocket.wav',
  explosion: '/assets/audio/gta2/sfx/explosion.wav',
  crash: '/assets/audio/gta2/sfx/crash.wav',
  fire: '/assets/audio/gta2/sfx/fire.wav',
  meleeSwing: '/assets/audio/gta2/sfx/melee-swing.wav',
  meleeHit: '/assets/audio/gta2/sfx/melee-hit.wav',
  pickup: '/assets/audio/gta2/sfx/pickup.wav',
  repair: '/assets/audio/gta2/sfx/repair.wav',
  respawn: '/assets/audio/gta2/sfx/respawn.wav'
} as const;

type SampleKey = keyof typeof SAMPLES;

export class SfxSystem {
  private readonly bus = new AudioBus();
  private readonly heard = new Map<string, number>();
  private readonly buffers = new Map<SampleKey, Promise<AudioBuffer | undefined>>();
  private readonly removeMessage: (() => void) | undefined;
  private listener?: AudioListenerPosition;

  constructor(private readonly room: Room<DistrictNetworkState>) {
    const remove = room.onMessage<AudioEventsMessage>(AUDIO_EVENTS_MESSAGE, (message) => {
      this.handle(message);
    });
    this.removeMessage = typeof remove === 'function' ? remove : undefined;
  }

  synchronize(player?: NetworkPlayer, vehicle?: NetworkVehicle): void {
    if (!player?.alive) {
      this.listener = undefined;
      return;
    }
    this.listener = vehicle && player.vehicleId
      ? {x: vehicle.x, y: vehicle.y, angle: vehicle.angle}
      : {x: player.x, y: player.y, angle: player.angle};
  }

  destroy(): void {
    this.removeMessage?.();
    this.bus.destroy();
  }

  private handle(message: AudioEventsMessage): void {
    const nowMs = performance.now();
    this.prune(nowMs);
    for (const event of message.events) {
      if (this.heard.has(event.id)) continue;
      this.heard.set(event.id, nowMs);
      this.play(event);
    }
  }

  private play(event: AudioEventPayload): void {
    if (!this.listener) return;
    const projection = projectPositionalAudio(
      this.listener,
      {x: event.x, y: event.y, maxDistance: maxDistance(event.kind)},
      gainFor(event)
    );
    if (projection.gain <= 0.01) return;
    switch (event.kind) {
      case 'weapon.fire':
        this.weaponFire(event, projection.gain, projection.pan);
        break;
      case 'explosion':
      case 'vehicle.destroyed':
        this.explosion(event, projection.gain, projection.pan);
        break;
      case 'vehicle.impact':
        this.impact(event, projection.gain, projection.pan);
        break;
      case 'vehicle.fire':
        this.fireWhoosh(projection.gain, projection.pan);
        break;
      case 'vehicle.repaired':
        void this.playSample('repair', projection.gain * 0.8, projection.pan, () => {
          this.chime(projection.gain * 0.8, projection.pan, 520, 740);
        });
        break;
      case 'pickup.weapon':
      case 'pickup.cash':
        void this.playSample('pickup', projection.gain, projection.pan, () => {
          this.chime(projection.gain, projection.pan, event.kind === 'pickup.cash' ? 780 : 620, 980);
        });
        break;
      case 'player.respawn':
        void this.playSample('respawn', projection.gain * 0.7, projection.pan, () => {
          this.chime(projection.gain * 0.7, projection.pan, 320, 520);
        });
        break;
      case 'melee.swing':
        void this.playSample('meleeSwing', projection.gain * 0.55, projection.pan, () => {
          this.noiseBurst(0.08, projection.gain * 0.35, projection.pan, 650);
        });
        break;
      case 'melee.hit':
        void this.playSample('meleeHit', projection.gain * 0.7, projection.pan, () => {
          this.impact(event, projection.gain * 0.7, projection.pan);
        });
        break;
    }
  }

  private weaponFire(event: AudioEventPayload, gain: number, pan: number): void {
    const variant = event.variant ?? 'pistol';
    const sample = variant === 'smg'
      ? 'smg'
      : variant === 'shotgun'
        ? 'shotgun'
        : variant === 'rocket'
          ? 'rocket'
          : 'pistol';
    void this.playSample(sample, gain, pan, () => {
      const duration = variant === 'smg' ? 0.055 : variant === 'shotgun' ? 0.13 : 0.085;
      const base = variant === 'shotgun' ? 110 : variant === 'rocket' ? 72 : 180;
      this.noiseBurst(duration, gain, pan, variant === 'shotgun' ? 1_800 : 2_800);
      this.tone(base, Math.max(0.04, duration * 0.75), gain * 0.42, pan, 'sawtooth');
    });
  }

  private explosion(event: AudioEventPayload, gain: number, pan: number): void {
    void this.playSample('explosion', gain, pan, () => {
      this.noiseBurst(0.42, gain, pan, 520);
      this.tone(event.kind === 'vehicle.destroyed' ? 58 : 46, 0.55, gain * 0.8, pan, 'sine');
    });
  }

  private impact(event: AudioEventPayload, gain: number, pan: number): void {
    const intensity = event.intensity ?? 0.5;
    void this.playSample('crash', gain * (0.75 + intensity * 0.3), pan, () => {
      this.noiseBurst(0.08 + intensity * 0.08, gain * 0.8, pan, 1_100);
      this.tone(150 + intensity * 170, 0.09, gain * 0.35, pan, 'triangle');
    });
  }

  private fireWhoosh(gain: number, pan: number): void {
    void this.playSample('fire', gain * 0.8, pan, () => {
      this.noiseBurst(0.32, gain * 0.72, pan, 760);
      this.tone(90, 0.25, gain * 0.22, pan, 'sawtooth');
    });
  }

  private chime(gain: number, pan: number, first: number, second: number): void {
    this.tone(first, 0.08, gain * 0.48, pan, 'sine');
    window.setTimeout(() => this.tone(second, 0.1, gain * 0.38, pan, 'sine'), 65);
  }

  private async playSample(
    sample: SampleKey,
    volume: number,
    pan: number,
    fallback: () => void
  ): Promise<void> {
    const buffer = await this.loadSample(sample);
    if (!buffer) {
      fallback();
      return;
    }
    const source = this.bus.createBufferSource();
    const gain = this.bus.createGain();
    if (!source || !gain) return;
    source.buffer = buffer;
    gain.gain.value = Math.max(0.0001, volume);
    this.connect(source, gain, undefined, pan);
    source.start(this.bus.now());
  }

  private loadSample(sample: SampleKey): Promise<AudioBuffer | undefined> {
    const existing = this.buffers.get(sample);
    if (existing) return existing;
    const loaded = this.bus.decodeAudio(SAMPLES[sample]).catch(() => undefined);
    this.buffers.set(sample, loaded);
    return loaded;
  }

  private noiseBurst(duration: number, volume: number, pan: number, lowpassHz: number): void {
    const source = this.bus.createBufferSource();
    const gain = this.bus.createGain();
    if (!source || !gain) return;
    const contextNow = this.bus.now();
    const buffer = this.bus.noiseBuffer(duration);
    if (!buffer) return;
    const context = source.context;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.0001, contextNow);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), contextNow + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, contextNow + duration);
    this.connect(source, filter, gain, pan);
    source.start(contextNow);
    source.stop(contextNow + duration + 0.03);
  }

  private tone(
    frequency: number,
    duration: number,
    volume: number,
    pan: number,
    type: OscillatorType
  ): void {
    const oscillator = this.bus.createOscillator();
    const gain = this.bus.createGain();
    if (!oscillator || !gain) return;
    const now = this.bus.now();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(22, frequency * 0.72), now + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    this.connect(oscillator, gain, undefined, pan);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private connect(
    source: AudioNode,
    first: AudioNode,
    second?: AudioNode,
    pan = 0
  ): void {
    const panner = this.bus.createStereoPanner();
    const output = this.bus.bus('sfx');
    if (!output) return;
    if (panner) panner.pan.value = pan;
    source.connect(first);
    if (second) {
      first.connect(second);
      second.connect(panner ?? output);
    } else {
      first.connect(panner ?? output);
    }
    if (panner) panner.connect(output);
  }

  private prune(nowMs: number): void {
    for (const [id, heardAt] of this.heard) {
      if (nowMs - heardAt > EVENT_TTL_MS) this.heard.delete(id);
    }
  }
}

function gainFor(event: AudioEventPayload): number {
  const intensity = event.intensity ?? 0.5;
  switch (event.kind) {
    case 'explosion':
    case 'vehicle.destroyed':
      return 1;
    case 'weapon.fire':
      return 0.38 + intensity * 0.5;
    case 'vehicle.impact':
      return 0.22 + intensity * 0.58;
      case 'pickup.cash':
      case 'pickup.weapon':
        return 0.34;
    default:
      return 0.28 + intensity * 0.38;
  }
}

function maxDistance(kind: AudioEventPayload['kind']): number {
  if (kind === 'explosion' || kind === 'vehicle.destroyed') return 1_650;
  if (kind === 'weapon.fire') return 1_250;
  if (kind === 'vehicle.impact') return 900;
  return 680;
}

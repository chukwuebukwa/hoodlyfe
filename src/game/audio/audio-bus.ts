export type AudioBusName = 'master' | 'sfx' | 'ambient' | 'voice';

export class AudioBus {
  private context?: AudioContext;
  private readonly gains = new Map<AudioBusName, GainNode>();
  private readonly cleanup: Array<() => void> = [];
  private unlocked = false;

  constructor(private readonly root: ParentNode = document) {
    this.bindUnlock();
  }

  get active(): boolean {
    return Boolean(this.context);
  }

  bus(name: AudioBusName): GainNode | undefined {
    const context = this.ensureContext();
    if (!context) return undefined;
    const existing = this.gains.get(name);
    if (existing) return existing;
    const gain = context.createGain();
    gain.gain.value = defaultGain(name);
    if (name === 'master') {
      gain.connect(context.destination);
    } else {
      gain.connect(this.bus('master') ?? context.destination);
    }
    this.gains.set(name, gain);
    return gain;
  }

  now(): number {
    return this.ensureContext()?.currentTime ?? 0;
  }

  createGain(): GainNode | undefined {
    return this.ensureContext()?.createGain();
  }

  createStereoPanner(): StereoPannerNode | undefined {
    const context = this.ensureContext();
    return context && 'createStereoPanner' in context ? context.createStereoPanner() : undefined;
  }

  createOscillator(): OscillatorNode | undefined {
    return this.ensureContext()?.createOscillator();
  }

  createBufferSource(): AudioBufferSourceNode | undefined {
    return this.ensureContext()?.createBufferSource();
  }

  async decodeAudio(url: string): Promise<AudioBuffer | undefined> {
    const context = this.ensureContext();
    if (!context) return undefined;
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const data = await response.arrayBuffer();
    return context.decodeAudioData(data.slice(0));
  }

  noiseBuffer(durationSeconds: number): AudioBuffer | undefined {
    const context = this.ensureContext();
    if (!context) return undefined;
    const length = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  destroy(): void {
    for (const remove of this.cleanup.splice(0)) remove();
    this.gains.clear();
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    const Constructor = window.AudioContext ?? window.webkitAudioContext;
    if (!Constructor) return undefined;
    this.context = new Constructor();
    return this.context;
  }

  private bindUnlock(): void {
    const unlock = () => {
      if (this.unlocked) return;
      const context = this.ensureContext();
      if (!context) return;
      void context.resume();
      this.unlocked = true;
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.cleanup.push(() => window.removeEventListener('pointerdown', unlock));
    this.cleanup.push(() => window.removeEventListener('keydown', unlock));
  }
}

function defaultGain(name: AudioBusName): number {
  if (name === 'master') return 0.9;
  if (name === 'voice') return 0.95;
  if (name === 'ambient') return 0.55;
  return 0.82;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

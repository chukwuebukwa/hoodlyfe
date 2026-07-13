import type {NetworkPlayer, NetworkVehicle} from '../types.ts';
import type {Room} from 'colyseus.js';
import type {DistrictNetworkState} from '../types.ts';
import {
  RADIO_STATION_MESSAGE,
  type RadioStationMessage
} from '../../../shared/protocol/radio.ts';
import {
  cycleStation,
  initialStationForVehicle,
  projectVehicleRadio
} from './radio-policy.ts';
import {
  RADIO_OFF,
  isRadioStationId,
  stationById,
  type RadioStation,
  type RadioStationId,
  type RadioTrack
} from './radio-stations.ts';

const FADE_MS = 450;
const RETUNE_DUCK_MS = 650;
const STORAGE_KEY = 'nock0-radio-station';

export class RadioSystem {
  private readonly cleanup: Array<() => void> = [];
  private readonly vehicleStations = new Map<string, RadioStationId>();
  private audio?: HTMLAudioElement;
  private currentVehicleId = '';
  private currentStationId: RadioStationId = savedStation();
  private currentTrackSrc = '';
  private unlocked = false;
  private destroyed = false;
  private fadeToken = 0;
  private retuneUntil = 0;

  constructor(
    private readonly root: ParentNode = document,
    private readonly room?: Room<DistrictNetworkState>
  ) {
    this.bindUnlock();
    this.bindRetune();
    this.updateHud(false, stationById(this.currentStationId));
  }

  synchronize(player?: NetworkPlayer, vehicle?: NetworkVehicle): void {
    if (this.destroyed) return;
    const nextVehicleId = player?.alive && player.vehicleId && vehicle && !vehicle.destroyed
      ? player.vehicleId
      : '';
    if (nextVehicleId && !this.vehicleStations.has(nextVehicleId)) {
      this.vehicleStations.set(nextVehicleId, this.currentStationId === RADIO_OFF
        ? initialStationForVehicle(nextVehicleId)
        : this.currentStationId);
    }
    const replicatedStation = isRadioStationId(vehicle?.radioStation ?? null)
      ? vehicle?.radioStation as RadioStationId
      : undefined;
    const stationId = nextVehicleId
      ? replicatedStation ?? this.vehicleStations.get(nextVehicleId) ?? initialStationForVehicle(nextVehicleId)
      : this.currentStationId;
    const projection = projectVehicleRadio(this.currentVehicleId, nextVehicleId, stationId);
    this.currentVehicleId = projection.vehicleId;
    this.currentStationId = projection.station.id;
    this.updateHud(projection.inVehicle, projection.station);
    if (!projection.inVehicle || projection.station.id === RADIO_OFF) {
      this.fadeOut();
      return;
    }
    if (projection.vehicleChanged || !this.audio || this.currentTrackSrc !== projection.station.tracks[0]?.src) {
      void this.playStation(projection.station, true);
    } else {
      this.applyTargetVolume(projection.station);
    }
  }

  cycle(direction: -1 | 1): void {
    if (!this.currentVehicleId) return;
    const next = cycleStation(this.currentStationId, direction);
    this.currentStationId = next;
    this.vehicleStations.set(this.currentVehicleId, next);
    window.localStorage.setItem(STORAGE_KEY, next);
    this.room?.send(RADIO_STATION_MESSAGE, {stationId: next} satisfies RadioStationMessage);
    this.retuneUntil = performance.now() + RETUNE_DUCK_MS;
    const station = stationById(next);
    this.showNotice(station.label);
    this.updateHud(true, station);
    if (next === RADIO_OFF) {
      this.fadeOut();
      return;
    }
    void this.playStation(station, true);
  }

  destroy(): void {
    this.destroyed = true;
    for (const remove of this.cleanup.splice(0)) remove();
    this.stopAudio();
    this.root.querySelector('#radio-hud')?.classList.add('hidden');
  }

  private async playStation(station: RadioStation, syncToBroadcast: boolean): Promise<void> {
    const track = station.tracks[0];
    if (!track) return;
    const audio = this.ensureAudio(track);
    if (syncToBroadcast) this.seekToBroadcastTimeline(audio, station, track);
    this.applyTargetVolume(station, 0);
    try {
      await audio.play();
      this.unlocked = true;
      this.fadeTo(targetVolume(station, this.retuneUntil), FADE_MS);
    } catch {
      this.updateHud(Boolean(this.currentVehicleId), station, 'Press any key for radio');
    }
  }

  private ensureAudio(track: RadioTrack): HTMLAudioElement {
    if (this.audio && this.currentTrackSrc === track.src) return this.audio;
    this.stopAudio();
    const audio = new Audio(track.src);
    audio.loop = true;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    this.audio = audio;
    this.currentTrackSrc = track.src;
    return audio;
  }

  private seekToBroadcastTimeline(
    audio: HTMLAudioElement,
    station: RadioStation,
    track: RadioTrack
  ): void {
    const apply = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (duration > 4) {
        const stationOffsetSeconds = hash(`${station.id}:${track.src}`) % Math.floor(duration);
        const reentrySkipSeconds = 7;
        audio.currentTime = (Date.now() / 1000 + stationOffsetSeconds + reentrySkipSeconds) % duration;
      }
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      apply();
    } else {
      audio.addEventListener('loadedmetadata', apply, {once: true});
    }
  }

  private fadeOut(): void {
    if (!this.audio) {
      this.updateHud(false, stationById(this.currentStationId));
      return;
    }
    const token = ++this.fadeToken;
    const audio = this.audio;
    const startVolume = audio.volume;
    const start = performance.now();
    const tick = () => {
      if (token !== this.fadeToken || this.destroyed) return;
      const progress = Math.min(1, (performance.now() - start) / FADE_MS);
      audio.volume = startVolume * (1 - progress);
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        audio.pause();
        this.updateHud(false, stationById(this.currentStationId));
      }
    };
    requestAnimationFrame(tick);
  }

  private fadeTo(volume: number, durationMs: number): void {
    const audio = this.audio;
    if (!audio) return;
    const token = ++this.fadeToken;
    const startVolume = audio.volume;
    const start = performance.now();
    const tick = () => {
      if (token !== this.fadeToken || this.destroyed || !this.audio) return;
      const progress = Math.min(1, (performance.now() - start) / durationMs);
      this.audio.volume = startVolume + (volume - startVolume) * progress;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private applyTargetVolume(station: RadioStation, fallback?: number): void {
    if (!this.audio) return;
    this.audio.volume = fallback ?? targetVolume(station, this.retuneUntil);
  }

  private stopAudio(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.src = '';
    this.audio.load();
    this.audio = undefined;
    this.currentTrackSrc = '';
  }

  private bindUnlock(): void {
    const unlock = () => {
      if (this.unlocked || !this.currentVehicleId || this.currentStationId === RADIO_OFF) return;
      void this.playStation(stationById(this.currentStationId), false);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    this.cleanup.push(() => window.removeEventListener('keydown', unlock));
    this.cleanup.push(() => window.removeEventListener('pointerdown', unlock));
  }

  private bindRetune(): void {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyR') return;
      this.cycle(event.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', keydown);
    this.cleanup.push(() => window.removeEventListener('keydown', keydown));
    this.bindButton('#radio-prev', () => this.cycle(-1));
    this.bindButton('#radio-next', () => this.cycle(1));
  }

  private bindButton(selector: string, action: () => void): void {
    const button = this.root.querySelector(selector);
    if (!button) return;
    const listener = (event: Event) => {
      event.stopPropagation();
      action();
    };
    button.addEventListener('click', listener);
    this.cleanup.push(() => button.removeEventListener('click', listener));
  }

  private updateHud(inVehicle: boolean, station: RadioStation, hint = ''): void {
    const hud = this.root.querySelector<HTMLElement>('#radio-hud');
    const label = this.root.querySelector('#radio-station');
    const meta = this.root.querySelector('#radio-meta');
    if (!hud) return;
    hud.classList.toggle('hidden', !inVehicle);
    hud.dataset.station = station.id;
    if (label) label.textContent = station.shortLabel;
    if (meta) meta.textContent = hint || (station.tracks[0]?.title ?? station.label);
  }

  private showNotice(label: string): void {
    const toast = this.root.querySelector<HTMLElement>('#event-toast');
    if (!toast) return;
    toast.textContent = label.toUpperCase();
    toast.setAttribute('data-tone', 'info');
    toast.classList.add('visible');
    window.setTimeout(() => toast.classList.remove('visible'), 900);
  }
}

function savedStation(): RadioStationId {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return isRadioStationId(saved) ? saved : 'station-0';
}

function targetVolume(station: RadioStation, retuneUntil: number): number {
  const ducked = performance.now() < retuneUntil;
  return station.defaultVolume * (ducked ? 0.28 : 1);
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

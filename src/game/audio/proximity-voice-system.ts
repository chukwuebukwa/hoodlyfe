import type {Room as ColyseusRoom} from 'colyseus.js';
import {
  Room as LiveKitRoom,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client';
import {
  VOICE_PEERS_MESSAGE,
  VOICE_TOKEN_REQUEST_MESSAGE,
  VOICE_TOKEN_RESPONSE_MESSAGE,
  type VoicePeersMessage,
  type VoiceTokenResponse
} from '../../../shared/protocol/proximity-voice.ts';
import {
  PROXIMITY_VOICE,
  proximityVoiceGain
} from '../../../shared/simulation/proximity-voice-policy.ts';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';
import {AudioBus} from './audio-bus.ts';
import {projectPositionalAudio} from './positional-audio-policy.ts';

interface RemoteVoiceNode {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  pan?: StereoPannerNode;
}

type VoiceState = 'off' | 'connecting' | 'ready' | 'talking' | 'unavailable' | 'error';

export class ProximityVoiceSystem {
  private readonly bus = new AudioBus();
  private readonly remoteNodes = new Map<string, RemoteVoiceNode>();
  private readonly peerIds = new Set<string>();
  private readonly cleanup: Array<() => void> = [];
  private readonly button = document.querySelector<HTMLButtonElement>('#voice-button');
  private readonly touchButton = document.querySelector<HTMLButtonElement>('#voice-touch-button');
  private readonly status = document.querySelector<HTMLElement>('#voice-status');
  private liveKit?: LiveKitRoom;
  private connection?: Promise<void>;
  private pendingToken?: {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: number;
  };
  private talkingRequested = false;
  private autoJoinAttempted = false;
  private destroyed = false;
  private latestState?: DistrictNetworkState;

  constructor(private readonly room: ColyseusRoom<DistrictNetworkState>) {
    const removeToken = room.onMessage<VoiceTokenResponse>(
      VOICE_TOKEN_RESPONSE_MESSAGE,
      (message) => void this.handleToken(message)
    );
    const removePeers = room.onMessage<VoicePeersMessage>(VOICE_PEERS_MESSAGE, (message) => {
      this.setPeers(message.peerIds);
    });
    if (typeof removeToken === 'function') this.cleanup.push(removeToken);
    if (typeof removePeers === 'function') this.cleanup.push(removePeers);
    this.button?.addEventListener('click', this.handleToggle);
    this.touchButton?.addEventListener('pointerdown', this.handleTouchDown);
    this.touchButton?.addEventListener('pointerup', this.handleTouchUp);
    this.touchButton?.addEventListener('pointercancel', this.handleTouchUp);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.cleanup.push(() => this.button?.removeEventListener('click', this.handleToggle));
    this.cleanup.push(() => this.touchButton?.removeEventListener('pointerdown', this.handleTouchDown));
    this.cleanup.push(() => this.touchButton?.removeEventListener('pointerup', this.handleTouchUp));
    this.cleanup.push(() => this.touchButton?.removeEventListener('pointercancel', this.handleTouchUp));
    this.cleanup.push(() => window.removeEventListener('keydown', this.handleKeyDown));
    this.cleanup.push(() => window.removeEventListener('keyup', this.handleKeyUp));
    this.renderState('off');
  }

  synchronize(state: DistrictNetworkState): void {
    this.latestState = state;
    const local = state.players.get(this.room.sessionId);
    if (local && !this.autoJoinAttempted) {
      this.autoJoinAttempted = true;
      void this.enable().catch(() => undefined);
    }
    const listener = local && effectivePosition(local, state);
    const now = this.bus.now();
    for (const [playerId, node] of this.remoteNodes) {
      const remote = state.players.get(playerId);
      const source = remote && effectivePosition(remote, state);
      let gain = 0;
      let pan = 0;
      if (
        listener && source && local?.alive && remote?.alive &&
        listener.spaceId === source.spaceId && this.peerIds.has(playerId)
      ) {
        const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
        gain = proximityVoiceGain(distance);
        pan = projectPositionalAudio(
          listener,
          {...source, maxDistance: PROXIMITY_VOICE.audibleDistance}
        ).pan;
      }
      node.gain.gain.setTargetAtTime(gain, now, 0.075);
      node.pan?.pan.setTargetAtTime(pan, now, 0.09);
    }
  }

  playerVoiceActivity(playerId: string): number {
    if (playerId !== this.room.sessionId && !this.peerIds.has(playerId)) return 0;
    const participant = playerId === this.room.sessionId
      ? this.liveKit?.localParticipant
      : this.liveKit?.remoteParticipants.get(playerId);
    if (!participant?.isSpeaking) return 0;
    return Math.max(0.08, Math.min(1, participant?.audioLevel ?? 0));
  }

  destroy(): void {
    this.destroyed = true;
    this.talkingRequested = false;
    for (const remove of this.cleanup.splice(0)) remove();
    if (this.pendingToken) {
      window.clearTimeout(this.pendingToken.timeout);
      this.pendingToken.reject(new Error('Voice chat was closed.'));
      this.pendingToken = undefined;
    }
    for (const node of this.remoteNodes.values()) disconnectNode(node);
    this.remoteNodes.clear();
    void this.liveKit?.disconnect();
    this.liveKit = undefined;
    this.bus.destroy();
  }

  private enable(): Promise<void> {
    if (this.liveKit) return Promise.resolve();
    if (this.connection) return this.connection;
    this.renderState('connecting');
    this.connection = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingToken = undefined;
        reject(new Error('Voice token timed out.'));
      }, 8_000);
      this.pendingToken = {resolve, reject, timeout};
      this.room.send(VOICE_TOKEN_REQUEST_MESSAGE);
    }).catch((error) => {
      if (!this.destroyed) {
        this.renderState(error instanceof VoiceUnavailableError ? 'unavailable' : 'error');
      }
      throw error;
    }).finally(() => {
      this.connection = undefined;
    });
    return this.connection;
  }

  private async handleToken(message: VoiceTokenResponse): Promise<void> {
    const pending = this.pendingToken;
    if (!pending) return;
    this.pendingToken = undefined;
    window.clearTimeout(pending.timeout);
    if (!message.enabled || !message.url || !message.token) {
      pending.reject(new VoiceUnavailableError(message.reason));
      return;
    }
    this.connect(message.url, message.token).then(pending.resolve, pending.reject);
  }

  private async connect(url: string, token: string): Promise<void> {
    if (this.destroyed || this.liveKit) return;
    const liveKit = new LiveKitRoom({
      adaptiveStream: false,
      dynacast: false,
      stopLocalTrackOnUnpublish: true
    });
    liveKit
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed)
      .on(RoomEvent.TrackPublished, this.handleTrackPublished)
      .on(RoomEvent.ParticipantDisconnected, this.handleParticipantDisconnected)
      .on(RoomEvent.Disconnected, this.handleVoiceDisconnected);
    await liveKit.connect(url, token, {autoSubscribe: false});
    this.liveKit = liveKit;
    this.applyPeerPermissions();
    this.synchronizeSubscriptions();
    this.renderState('ready');
  }

  private setPeers(peerIds: readonly string[]): void {
    this.peerIds.clear();
    for (const playerId of peerIds) {
      if (typeof playerId === 'string' && playerId !== this.room.sessionId) {
        this.peerIds.add(playerId);
      }
    }
    this.applyPeerPermissions();
    this.synchronizeSubscriptions();
  }

  private applyPeerPermissions(): void {
    this.liveKit?.localParticipant.setTrackSubscriptionPermissions(
      false,
      [...this.peerIds].map((participantIdentity) => ({participantIdentity, allowAll: true}))
    );
  }

  private synchronizeSubscriptions(): void {
    if (!this.liveKit) return;
    for (const participant of this.liveKit.remoteParticipants.values()) {
      const subscribed = this.peerIds.has(participant.identity);
      for (const publication of participant.trackPublications.values()) {
        if (publication.source === Track.Source.Microphone) publication.setSubscribed(subscribed);
      }
    }
  }

  private async setTalking(talking: boolean): Promise<void> {
    this.talkingRequested = talking;
    if (!this.liveKit && talking) {
      try {
        await this.enable();
      } catch {
        return;
      }
    }
    await this.applyTalkingState();
  }

  private async applyTalkingState(): Promise<void> {
    if (!this.liveKit) return;
    await this.liveKit.localParticipant.setMicrophoneEnabled(this.talkingRequested, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    });
    this.renderState(this.talkingRequested ? 'talking' : 'ready');
  }

  private async prepareMicrophone(): Promise<void> {
    try {
      await this.enable();
      if (!this.liveKit) return;
      await this.liveKit.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      });
      await this.liveKit.localParticipant.setMicrophoneEnabled(false);
      this.talkingRequested = false;
      this.renderState('ready');
    } catch {
      if (!this.destroyed) this.renderState('error');
    }
  }

  private readonly handleTrackSubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void => {
    if (track.kind !== Track.Kind.Audio) return;
    const stream = new MediaStream([track.mediaStreamTrack]);
    const source = this.bus.createMediaStreamSource(stream);
    const gain = this.bus.createGain();
    const voice = this.bus.bus('voice');
    if (!source || !gain || !voice) return;
    const pan = this.bus.createStereoPanner();
    gain.gain.value = 0;
    source.connect(gain);
    if (pan) {
      gain.connect(pan);
      pan.connect(voice);
    } else {
      gain.connect(voice);
    }
    const previous = this.remoteNodes.get(participant.identity);
    if (previous) disconnectNode(previous);
    this.remoteNodes.set(participant.identity, {source, gain, pan});
    if (this.latestState) this.synchronize(this.latestState);
  };

  private readonly handleTrackUnsubscribed = (
    _track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void => this.removeRemoteNode(participant.identity);

  private readonly handleTrackPublished = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void => {
    if (publication.source === Track.Source.Microphone) {
      publication.setSubscribed(this.peerIds.has(participant.identity));
    }
  };

  private readonly handleParticipantDisconnected = (participant: RemoteParticipant): void => {
    this.removeRemoteNode(participant.identity);
  };

  private readonly handleVoiceDisconnected = (): void => {
    for (const node of this.remoteNodes.values()) disconnectNode(node);
    this.remoteNodes.clear();
    this.liveKit = undefined;
    this.talkingRequested = false;
    if (!this.destroyed) this.renderState('off');
  };

  private removeRemoteNode(playerId: string): void {
    const node = this.remoteNodes.get(playerId);
    if (!node) return;
    disconnectNode(node);
    this.remoteNodes.delete(playerId);
  }

  private renderState(state: VoiceState): void {
    if (this.button) {
      this.button.dataset.state = state;
      this.button.setAttribute('aria-pressed', String(state !== 'off' && state !== 'unavailable'));
      this.button.textContent = state === 'talking' ? 'ON AIR' : state === 'connecting' ? 'VOICE…' : 'VOICE';
    }
    if (this.touchButton) {
      this.touchButton.dataset.state = state;
      this.touchButton.classList.toggle('talking', state === 'talking');
    }
    if (this.status) {
      this.status.textContent = state === 'off'
        ? 'OFF'
        : state === 'connecting'
          ? 'CONNECTING'
          : state === 'ready'
            ? 'LISTENING'
            : state === 'talking'
              ? 'TRANSMITTING'
              : state === 'unavailable'
                ? 'UNAVAILABLE'
                : 'VOICE ERROR';
    }
  }

  private readonly handleToggle = (): void => {
    void this.prepareMicrophone();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyV' || event.repeat || isEditable(event.target)) return;
    event.preventDefault();
    void this.setTalking(true);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyV') return;
    event.preventDefault();
    void this.setTalking(false);
  };

  private readonly handleTouchDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.touchButton?.setPointerCapture(event.pointerId);
    void this.setTalking(true);
  };

  private readonly handleTouchUp = (event: PointerEvent): void => {
    event.preventDefault();
    void this.setTalking(false);
  };
}

class VoiceUnavailableError extends Error {
  constructor(reason?: VoiceTokenResponse['reason']) {
    super(`Proximity voice is unavailable: ${reason ?? 'unconfigured'}`);
  }
}

function effectivePosition(player: NetworkPlayer, state: DistrictNetworkState): {
  x: number;
  y: number;
  spaceId: string;
} {
  const vehicle = player.vehicleId ? state.vehicles.get(player.vehicleId) : undefined;
  return {
    x: vehicle?.x ?? player.x,
    y: vehicle?.y ?? player.y,
    spaceId: player.spaceId || 'street'
  };
}

function disconnectNode(node: RemoteVoiceNode): void {
  node.source.disconnect();
  node.gain.disconnect();
  node.pan?.disconnect();
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

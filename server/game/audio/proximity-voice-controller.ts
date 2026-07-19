import {AccessToken, TrackSource} from 'livekit-server-sdk';
import {
  VOICE_PEERS_MESSAGE,
  VOICE_TOKEN_RESPONSE_MESSAGE,
  type VoicePeersMessage,
  type VoiceTokenResponse
} from '../../../shared/protocol/proximity-voice.ts';
import {
  PROXIMITY_VOICE,
  selectProximityVoicePeers,
  type ProximityVoiceActor
} from '../../../shared/simulation/proximity-voice-policy.ts';
import type {DistrictState, PlayerState} from '../../state.ts';

interface ProximityVoiceControllerOptions {
  state: DistrictState;
  roomName: string;
  send: (playerId: string, type: string, payload: VoicePeersMessage | VoiceTokenResponse) => void;
  now?: () => number;
  liveKitUrl?: string;
  liveKitApiKey?: string;
  liveKitApiSecret?: string;
}

export class ProximityVoiceController {
  private readonly peers = new Map<string, Set<string>>();
  private readonly now: () => number;
  private readonly liveKitUrl: string;
  private readonly liveKitApiKey: string;
  private readonly liveKitApiSecret: string;
  private lastSynchronizedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: ProximityVoiceControllerOptions) {
    this.now = options.now ?? Date.now;
    this.liveKitUrl = options.liveKitUrl ?? process.env.LIVEKIT_URL ?? '';
    this.liveKitApiKey = options.liveKitApiKey ?? process.env.LIVEKIT_API_KEY ?? '';
    this.liveKitApiSecret = options.liveKitApiSecret ?? process.env.LIVEKIT_API_SECRET ?? '';
  }

  get enabled(): boolean {
    return Boolean(this.liveKitUrl && this.liveKitApiKey && this.liveKitApiSecret);
  }

  async issueToken(playerId: string): Promise<void> {
    const player = this.options.state.players.get(playerId);
    if (!player) {
      this.sendToken(playerId, {enabled: false, reason: 'player-unavailable'});
      return;
    }
    if (!this.enabled) {
      this.sendToken(playerId, {enabled: false, reason: 'unconfigured'});
      return;
    }
    try {
      const accessToken = new AccessToken(this.liveKitApiKey, this.liveKitApiSecret, {
        identity: playerId,
        name: player.name,
        ttl: '2h'
      });
      accessToken.addGrant({
        room: this.options.roomName,
        roomJoin: true,
        canPublish: true,
        canPublishData: false,
        canPublishSources: [TrackSource.MICROPHONE],
        canSubscribe: true
      });
      this.sendToken(playerId, {
        enabled: true,
        url: this.liveKitUrl,
        token: await accessToken.toJwt()
      });
      this.synchronize(true);
      this.options.send(playerId, VOICE_PEERS_MESSAGE, {
        peerIds: [...(this.peers.get(playerId) ?? [])].sort()
      });
    } catch {
      this.sendToken(playerId, {enabled: false, reason: 'token-failed'});
    }
  }

  synchronize(force = false): void {
    if (!this.enabled) return;
    const now = this.now();
    if (!force && now - this.lastSynchronizedAt < PROXIMITY_VOICE.updateIntervalMs) return;
    this.lastSynchronizedAt = now;
    const actors = [...this.options.state.players.values()].map((player) => this.actor(player));
    const activeIds = new Set(actors.map(({id}) => id));
    for (const actor of actors) {
      const previous = this.peers.get(actor.id) ?? new Set<string>();
      const next = selectProximityVoicePeers(actor, actors, previous);
      if (!equalIds(previous, next)) {
        this.peers.set(actor.id, new Set(next));
        this.options.send(actor.id, VOICE_PEERS_MESSAGE, {peerIds: next});
      }
    }
    for (const playerId of this.peers.keys()) {
      if (!activeIds.has(playerId)) this.peers.delete(playerId);
    }
  }

  clearPlayer(playerId: string): void {
    this.peers.delete(playerId);
    for (const [listenerId, peers] of this.peers) {
      if (!peers.delete(playerId)) continue;
      this.options.send(listenerId, VOICE_PEERS_MESSAGE, {peerIds: [...peers].sort()});
    }
  }

  private actor(player: PlayerState): ProximityVoiceActor {
    const vehicle = player.vehicleId
      ? this.options.state.vehicles.get(player.vehicleId)
      : undefined;
    return {
      id: player.id,
      x: vehicle?.x ?? player.x,
      y: vehicle?.y ?? player.y,
      spaceId: player.spaceId || 'street',
      alive: player.alive
    };
  }

  private sendToken(playerId: string, payload: VoiceTokenResponse): void {
    this.options.send(playerId, VOICE_TOKEN_RESPONSE_MESSAGE, payload);
  }
}

function equalIds(previous: ReadonlySet<string>, next: readonly string[]): boolean {
  return previous.size === next.length && next.every((id) => previous.has(id));
}

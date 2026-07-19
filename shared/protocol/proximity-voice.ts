export const VOICE_TOKEN_REQUEST_MESSAGE = 'voice.token.request';
export const VOICE_TOKEN_RESPONSE_MESSAGE = 'voice.token.response';
export const VOICE_PEERS_MESSAGE = 'voice.peers';

export interface VoiceTokenResponse {
  enabled: boolean;
  url?: string;
  token?: string;
  reason?: 'unconfigured' | 'player-unavailable' | 'token-failed';
}

export interface VoicePeersMessage {
  peerIds: string[];
}

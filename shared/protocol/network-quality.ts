export const NETWORK_PING_MESSAGE = 'network.ping';
export const NETWORK_PONG_MESSAGE = 'network.pong';

export interface NetworkPingMessage {
  sequence: number;
  clientSentAt: number;
}

export interface NetworkPongMessage extends NetworkPingMessage {
  serverReceivedAt: number;
  serverTick: number;
  serverRegion: string;
  buildId: string;
}

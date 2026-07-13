import type {
  NetworkPingMessage,
  NetworkPongMessage
} from '../../../shared/protocol/network-quality.ts';

const MIN_PROBE_INTERVAL_MS = 250;
const MAX_SEQUENCE_JUMP = 10_000;

interface NetworkProbeControllerOptions {
  region: string;
  buildId: string;
}

export class NetworkProbeController {
  private readonly lastProbeAt = new Map<string, number>();
  private readonly lastSequence = new Map<string, number>();

  constructor(private readonly options: NetworkProbeControllerOptions) {}

  accept(
    playerId: string,
    message: NetworkPingMessage | undefined,
    nowMs: number,
    serverTick: number
  ): NetworkPongMessage | undefined {
    const sequence = Number(message?.sequence);
    const clientSentAt = Number(message?.clientSentAt);
    const previousSequence = this.lastSequence.get(playerId) ?? 0;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= previousSequence ||
      sequence - previousSequence > MAX_SEQUENCE_JUMP ||
      !Number.isFinite(clientSentAt) ||
      nowMs - (this.lastProbeAt.get(playerId) ?? Number.NEGATIVE_INFINITY) < MIN_PROBE_INTERVAL_MS
    ) return undefined;
    this.lastProbeAt.set(playerId, nowMs);
    this.lastSequence.set(playerId, sequence);
    return {
      sequence,
      clientSentAt,
      serverReceivedAt: nowMs,
      serverTick,
      serverRegion: this.options.region,
      buildId: this.options.buildId
    };
  }

  clear(playerId: string): void {
    this.lastProbeAt.delete(playerId);
    this.lastSequence.delete(playerId);
  }
}

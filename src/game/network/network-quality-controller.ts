import type {Room} from 'colyseus.js';
import {
  NETWORK_PING_MESSAGE,
  NETWORK_PONG_MESSAGE,
  type NetworkPingMessage,
  type NetworkPongMessage
} from '../../../shared/protocol/network-quality.ts';
import type {DistrictNetworkState} from '../types.ts';

const PROBE_INTERVAL_MS = 1_000;
const SAMPLE_LIMIT = 30;

export interface NetworkQualitySnapshot {
  region: string;
  buildId: string;
  rttMedianMs: number;
  rttP95Ms: number;
  jitterMs: number;
  patchGapP95Ms: number;
  serverTick: number;
  predictionError: number;
  reconciliations: number;
}

interface NetworkQualityControllerOptions {
  now?: () => number;
}

export class NetworkQualityController {
  private readonly rttSamples: number[] = [];
  private readonly patchGaps: number[] = [];
  private readonly cleanup: Array<() => void> = [];
  private readonly now: () => number;
  private sequence = 0;
  private nextProbeAt = Number.NEGATIVE_INFINITY;
  private lastPatchAt = 0;
  private region = 'unknown';
  private buildId = 'unknown';
  private serverTick = 0;
  private predictionError = 0;
  private reconciliations = 0;

  constructor(
    private readonly room: Room<DistrictNetworkState>,
    options: NetworkQualityControllerOptions = {}
  ) {
    this.now = options.now ?? (() => performance.now());
    const removePong = room.onMessage<NetworkPongMessage>(
      NETWORK_PONG_MESSAGE,
      this.handlePong
    );
    if (typeof removePong === 'function') this.cleanup.push(removePong as () => void);
    const removeState = room.onStateChange(() => this.observePatch(this.now()));
    if (typeof removeState === 'function') this.cleanup.push(removeState as () => void);
  }

  update(nowMs = this.now()): void {
    if (nowMs < this.nextProbeAt) return;
    this.sequence++;
    const message: NetworkPingMessage = {sequence: this.sequence, clientSentAt: nowMs};
    this.room.send(NETWORK_PING_MESSAGE, message);
    this.nextProbeAt = nowMs + PROBE_INTERVAL_MS;
  }

  observePatch(nowMs = this.now()): void {
    if (this.lastPatchAt > 0) pushBounded(this.patchGaps, nowMs - this.lastPatchAt);
    this.lastPatchAt = nowMs;
  }

  observePrediction(error: number, snapped: boolean): void {
    if (!Number.isFinite(error)) return;
    this.predictionError = Math.max(0, error);
    if (snapped) this.reconciliations++;
  }

  snapshot(): NetworkQualitySnapshot {
    const sortedRtt = [...this.rttSamples].sort((left, right) => left - right);
    const jitterSamples: number[] = [];
    for (let index = 1; index < this.rttSamples.length; index++) {
      jitterSamples.push(Math.abs(this.rttSamples[index] - this.rttSamples[index - 1]));
    }
    return {
      region: this.region,
      buildId: this.buildId,
      rttMedianMs: percentile(sortedRtt, 50),
      rttP95Ms: percentile(sortedRtt, 95),
      jitterMs: percentile(jitterSamples.sort((left, right) => left - right), 95),
      patchGapP95Ms: percentile([...this.patchGaps].sort((left, right) => left - right), 95),
      serverTick: this.serverTick,
      predictionError: Math.round(this.predictionError * 10) / 10,
      reconciliations: this.reconciliations
    };
  }

  destroy(): void {
    for (const remove of this.cleanup.splice(0)) remove();
  }

  private readonly handlePong = (message: NetworkPongMessage): void => {
    if (!Number.isFinite(message?.clientSentAt) || !Number.isSafeInteger(message?.sequence)) return;
    const rtt = this.now() - message.clientSentAt;
    if (rtt < 0 || rtt > 30_000) return;
    pushBounded(this.rttSamples, rtt);
    this.region = String(message.serverRegion || 'unknown');
    this.buildId = String(message.buildId || 'unknown').slice(0, 12);
    this.serverTick = Number.isFinite(message.serverTick) ? message.serverTick : this.serverTick;
  };
}

function pushBounded(values: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  values.push(value);
  if (values.length > SAMPLE_LIMIT) values.splice(0, values.length - SAMPLE_LIMIT);
}

function percentile(sorted: readonly number[], requested: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(requested / 100 * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] * 10) / 10;
}

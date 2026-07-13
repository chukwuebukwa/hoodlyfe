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
  clockOffsetMs: number;
  estimatedServerTimeMs: number;
  interpolationDelayMs: number;
  clockSynchronized: boolean;
  predictionError: number;
  predictionErrorP95: number;
  predictionErrorMean: number;
  predictionCorrections: number;
  reconciliations: number;
  vehicleResimulations: number;
  vehiclePendingMoves: number;
  vehicleAcknowledgedMove: number;
}

interface NetworkQualityControllerOptions {
  now?: () => number;
}

export class NetworkQualityController {
  private readonly rttSamples: number[] = [];
  private readonly patchGaps: number[] = [];
  private readonly clockOffsets: number[] = [];
  private readonly predictionErrors: number[] = [];
  private readonly cleanup: Array<() => void> = [];
  private readonly now: () => number;
  private sequence = 0;
  private nextProbeAt = Number.NEGATIVE_INFINITY;
  private lastPatchAt = 0;
  private region = 'unknown';
  private buildId = 'unknown';
  private serverTick = 0;
  private clockOffsetMs = 0;
  private predictionError = 0;
  private predictionCorrections = 0;
  private reconciliations = 0;
  private vehicleResimulations = 0;
  private vehiclePendingMoves = 0;
  private vehicleAcknowledgedMove = 0;

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
    const removeState = room.onStateChange((state) => {
      this.observePatch(this.now(), state?.serverTimeMs ?? 0, state?.serverTick ?? 0);
    });
    if (typeof removeState === 'function') this.cleanup.push(removeState as () => void);
  }

  update(nowMs = this.now()): void {
    if (nowMs < this.nextProbeAt) return;
    this.sequence++;
    const message: NetworkPingMessage = {sequence: this.sequence, clientSentAt: nowMs};
    this.room.send(NETWORK_PING_MESSAGE, message);
    this.nextProbeAt = nowMs + PROBE_INTERVAL_MS;
  }

  observePatch(nowMs = this.now(), _serverTimeMs = 0, serverTick = 0): void {
    if (this.lastPatchAt > 0) pushBounded(this.patchGaps, nowMs - this.lastPatchAt);
    this.lastPatchAt = nowMs;
    if (Number.isSafeInteger(serverTick) && serverTick >= this.serverTick) {
      this.serverTick = serverTick;
    }
  }

  observePrediction(
    error: number,
    snapped: boolean,
    pendingMoves = 0,
    acknowledgedMove = 0,
    resimulated = false
  ): void {
    if (!Number.isFinite(error)) return;
    this.predictionError = Math.max(0, error);
    pushBounded(this.predictionErrors, this.predictionError);
    this.predictionCorrections++;
    if (snapped) this.reconciliations++;
    if (resimulated) this.vehicleResimulations++;
    this.vehiclePendingMoves = Math.max(0, Math.floor(pendingMoves));
    this.vehicleAcknowledgedMove = Math.max(0, Math.floor(acknowledgedMove));
  }

  snapshot(): NetworkQualitySnapshot {
    const sortedRtt = [...this.rttSamples].sort((left, right) => left - right);
    const jitterSamples: number[] = [];
    for (let index = 1; index < this.rttSamples.length; index++) {
      jitterSamples.push(Math.abs(this.rttSamples[index] - this.rttSamples[index - 1]));
    }
    const patchGapP95Ms = percentile([...this.patchGaps].sort((left, right) => left - right), 95);
    const sortedPredictionErrors = [...this.predictionErrors].sort((left, right) => left - right);
    return {
      region: this.region,
      buildId: this.buildId,
      rttMedianMs: percentile(sortedRtt, 50),
      rttP95Ms: percentile(sortedRtt, 95),
      jitterMs: percentile(jitterSamples.sort((left, right) => left - right), 95),
      patchGapP95Ms,
      serverTick: this.serverTick,
      clockOffsetMs: Math.round(this.clockOffsetMs * 10) / 10,
      estimatedServerTimeMs: Math.round((this.now() + this.clockOffsetMs) * 10) / 10,
      interpolationDelayMs: Math.max(75, Math.min(250, patchGapP95Ms * 1.5 || 100)),
      clockSynchronized: this.clockOffsets.length > 0,
      predictionError: Math.round(this.predictionError * 10) / 10,
      predictionErrorP95: percentile(sortedPredictionErrors, 95),
      predictionErrorMean: mean(this.predictionErrors),
      predictionCorrections: this.predictionCorrections,
      reconciliations: this.reconciliations,
      vehicleResimulations: this.vehicleResimulations,
      vehiclePendingMoves: this.vehiclePendingMoves,
      vehicleAcknowledgedMove: this.vehicleAcknowledgedMove
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
    pushBounded(this.clockOffsets, message.serverReceivedAt - (message.clientSentAt + rtt / 2));
    this.clockOffsetMs = percentile(
      [...this.clockOffsets].sort((left, right) => left - right),
      50
    );
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

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10;
}

import type {Room} from 'colyseus.js';
import {
  NETWORK_PING_MESSAGE,
  NETWORK_PONG_MESSAGE,
  type NetworkPingMessage,
  type NetworkPongMessage
} from '../../../shared/protocol/network-quality.ts';
import type {DistrictNetworkState} from '../types.ts';
import type {RemoteMotionSample} from './remote-motion-timeline.ts';
import {adaptiveInterpolationDelayMs} from './remote-timeline-policy.ts';

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
  onFootResimulations: number;
  onFootPendingMoves: number;
  onFootAcknowledgedMove: number;
  remoteSnapshotAgeP95Ms: number;
  remoteBufferUnderrunPercent: number;
  remoteExtrapolationPercent: number;
  interactionIslandSize: number;
  interactionIslandPoints: number;
  interactionIslandBudget: number;
  interactionIslandOverflow: number;
  interactionIslandOverflowPoints: number;
  interactionIslandHorizonMs: number;
  interactionSnapshotAgeTicks: number;
}

export interface InteractionIslandObservation {
  readonly serverTick: number;
  readonly memberIds: readonly string[];
  readonly weightedPoints: number;
  readonly budget: number;
  readonly overflowIds: readonly string[];
  readonly overflowPoints: number;
  readonly horizonMs: number;
}

interface NetworkQualityControllerOptions {
  now?: () => number;
}

export class NetworkQualityController {
  private readonly rttSamples: number[] = [];
  private readonly patchGaps: number[] = [];
  private readonly clockOffsets: number[] = [];
  private readonly predictionErrors: number[] = [];
  private readonly remoteSnapshotAges: number[] = [];
  private readonly remoteBufferUnderruns: number[] = [];
  private readonly remoteExtrapolations: number[] = [];
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
  private onFootResimulations = 0;
  private onFootPendingMoves = 0;
  private onFootAcknowledgedMove = 0;
  private interactionIslandSize = 0;
  private interactionIslandPoints = 0;
  private interactionIslandBudget = 0;
  private interactionIslandOverflow = 0;
  private interactionIslandOverflowPoints = 0;
  private interactionIslandHorizonMs = 0;
  private interactionSnapshotTick = 0;

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
    if (!this.observeCorrection(error, snapped)) return;
    if (resimulated) this.vehicleResimulations++;
    this.vehiclePendingMoves = Math.max(0, Math.floor(pendingMoves));
    this.vehicleAcknowledgedMove = Math.max(0, Math.floor(acknowledgedMove));
  }

  observeOnFootPrediction(
    error: number,
    snapped: boolean,
    pendingMoves = 0,
    acknowledgedMove = 0,
    resimulated = false
  ): void {
    if (!this.observeCorrection(error, snapped)) return;
    if (resimulated) this.onFootResimulations++;
    this.onFootPendingMoves = Math.max(0, Math.floor(pendingMoves));
    this.onFootAcknowledgedMove = Math.max(0, Math.floor(acknowledgedMove));
  }

  observeRemoteTimeline(
    sample: Pick<RemoteMotionSample, 'snapshotAgeMs' | 'bufferUnderrun' | 'mode'>
  ): void {
    pushBounded(this.remoteSnapshotAges, sample.snapshotAgeMs, REMOTE_SAMPLE_LIMIT);
    pushBounded(this.remoteBufferUnderruns, sample.bufferUnderrun ? 1 : 0, REMOTE_SAMPLE_LIMIT);
    pushBounded(
      this.remoteExtrapolations,
      sample.mode === 'extrapolated' ? 1 : 0,
      REMOTE_SAMPLE_LIMIT
    );
  }

  observeInteractionIsland(observation: InteractionIslandObservation): void {
    this.interactionIslandSize = observation.memberIds.length;
    this.interactionIslandPoints = nonnegativeInteger(observation.weightedPoints);
    this.interactionIslandBudget = nonnegativeInteger(observation.budget);
    this.interactionIslandOverflow = observation.overflowIds.length;
    this.interactionIslandOverflowPoints = nonnegativeInteger(observation.overflowPoints);
    this.interactionIslandHorizonMs = roundedNonnegative(observation.horizonMs);
    this.interactionSnapshotTick = nonnegativeInteger(observation.serverTick);
  }

  snapshot(): NetworkQualitySnapshot {
    const sortedRtt = [...this.rttSamples].sort((left, right) => left - right);
    const jitterSamples: number[] = [];
    for (let index = 1; index < this.rttSamples.length; index++) {
      jitterSamples.push(Math.abs(this.rttSamples[index] - this.rttSamples[index - 1]));
    }
    const patchGapP95Ms = percentile([...this.patchGaps].sort((left, right) => left - right), 95);
    const sortedPredictionErrors = [...this.predictionErrors].sort((left, right) => left - right);
    const jitterMs = percentile(jitterSamples.sort((left, right) => left - right), 95);
    const rttMedianMs = percentile(sortedRtt, 50);
    const rttP95Ms = percentile(sortedRtt, 95);
    return {
      region: this.region,
      buildId: this.buildId,
      rttMedianMs,
      rttP95Ms,
      jitterMs,
      patchGapP95Ms,
      serverTick: this.serverTick,
      clockOffsetMs: Math.round(this.clockOffsetMs * 10) / 10,
      estimatedServerTimeMs: Math.round((this.now() + this.clockOffsetMs) * 10) / 10,
      interpolationDelayMs: adaptiveInterpolationDelayMs({
        patchGapP95Ms,
        jitterP95Ms: jitterMs,
        rttMedianMs,
        rttP95Ms
      }),
      clockSynchronized: this.clockOffsets.length > 0,
      predictionError: Math.round(this.predictionError * 10) / 10,
      predictionErrorP95: percentile(sortedPredictionErrors, 95),
      predictionErrorMean: mean(this.predictionErrors),
      predictionCorrections: this.predictionCorrections,
      reconciliations: this.reconciliations,
      vehicleResimulations: this.vehicleResimulations,
      vehiclePendingMoves: this.vehiclePendingMoves,
      vehicleAcknowledgedMove: this.vehicleAcknowledgedMove,
      onFootResimulations: this.onFootResimulations,
      onFootPendingMoves: this.onFootPendingMoves,
      onFootAcknowledgedMove: this.onFootAcknowledgedMove,
      remoteSnapshotAgeP95Ms: percentile(
        [...this.remoteSnapshotAges].sort((left, right) => left - right),
        95
      ),
      remoteBufferUnderrunPercent: percentage(this.remoteBufferUnderruns),
      remoteExtrapolationPercent: percentage(this.remoteExtrapolations),
      interactionIslandSize: this.interactionIslandSize,
      interactionIslandPoints: this.interactionIslandPoints,
      interactionIslandBudget: this.interactionIslandBudget,
      interactionIslandOverflow: this.interactionIslandOverflow,
      interactionIslandOverflowPoints: this.interactionIslandOverflowPoints,
      interactionIslandHorizonMs: this.interactionIslandHorizonMs,
      interactionSnapshotAgeTicks: this.interactionIslandBudget > 0
        ? Math.max(0, this.serverTick - this.interactionSnapshotTick)
        : 0
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

  private observeCorrection(error: number, snapped: boolean): boolean {
    if (!Number.isFinite(error)) return false;
    this.predictionError = Math.max(0, error);
    pushBounded(this.predictionErrors, this.predictionError);
    this.predictionCorrections++;
    if (snapped) this.reconciliations++;
    return true;
  }
}

const REMOTE_SAMPLE_LIMIT = 120;

function pushBounded(values: number[], value: number, limit = SAMPLE_LIMIT): void {
  if (!Number.isFinite(value) || value < 0) return;
  values.push(value);
  if (values.length > limit) values.splice(0, values.length - limit);
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

function percentage(values: readonly number[]): number {
  return Math.round(meanRaw(values) * 1_000) / 10;
}

function meanRaw(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nonnegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function roundedNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 10) / 10 : 0;
}

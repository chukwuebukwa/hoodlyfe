import {createWriteStream, mkdirSync, type WriteStream} from 'node:fs';
import {dirname} from 'node:path';
import type {VehicleMotionObservation} from '../world/district-simulation.ts';
import type {SimulationPhaseDiagnostic} from '../world/simulation-phase-pipeline.ts';

export interface SimulationEntityCounts {
  players: number;
  npcs: number;
  vehicles: number;
  bullets: number;
  rockets: number;
  thrownProjectiles: number;
  explosions: number;
  fires: number;
}

export interface SimulationObservationInput {
  tick: number;
  nowMs: number;
  droppedMs: number;
  eventsThisTick?: number;
  entities: SimulationEntityCounts;
  phases: readonly SimulationPhaseDiagnostic[];
  vehicleMotion?: VehicleMotionObservation;
}

export interface SimulationPhaseObservation {
  id: string;
  durationMs: number;
}

export interface SimulationObservationRecord {
  kind: 'sample' | 'hitch';
  tick: number;
  nowMs: number;
  recordedAt: string;
  tickDurationMs: number;
  droppedMs: number;
  droppedDeltaMs: number;
  eventsThisTick?: number;
  entities: SimulationEntityCounts;
  slowestPhase?: SimulationPhaseObservation;
  phases: SimulationPhaseObservation[];
  vehicleMotion?: VehicleMotionObservation;
}

export interface SimulationObservabilitySnapshot {
  roomId: string;
  buildId: string;
  journalFile?: string;
  latest?: SimulationObservationRecord;
  recentHitches: SimulationObservationRecord[];
}

export interface SimulationObservabilitySink {
  append(value: unknown): void;
  close(): void;
}

interface SimulationObservabilityOptions {
  roomId: string;
  buildId: string;
  stepMs: number;
  sampleIntervalTicks: number;
  journalFile?: string;
  sink?: SimulationObservabilitySink;
  now?: () => Date;
  onFailure?: (error: unknown) => void;
}

export class FileSimulationObservabilitySink implements SimulationObservabilitySink {
  private stream?: WriteStream;
  private failed = false;

  constructor(readonly filePath: string, private readonly onError?: (error: unknown) => void) {
    try {
      mkdirSync(dirname(filePath), {recursive: true});
      this.stream = createWriteStream(filePath, {flags: 'w'});
      this.stream.on('error', (error) => this.fail(error));
    } catch (error) {
      this.fail(error);
    }
  }

  append(value: unknown): void {
    if (!this.failed) this.stream?.write(`${JSON.stringify(value)}\n`);
  }

  close(): void {
    if (!this.failed) this.stream?.end();
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.onError?.(error);
  }
}

export class SimulationObservability {
  private sink?: SimulationObservabilitySink;
  private readonly recentHitches: SimulationObservationRecord[] = [];
  private latest?: SimulationObservationRecord;
  private lastDroppedMs = 0;

  constructor(private readonly options: SimulationObservabilityOptions) {
    this.sink = options.sink;
    this.append({
      kind: 'observability.header',
      version: 1,
      roomId: options.roomId,
      buildId: options.buildId,
      journalFile: options.journalFile,
      stepMs: options.stepMs,
      recordedAt: this.recordedAt()
    });
  }

  observe(input: SimulationObservationInput): SimulationObservationRecord | undefined {
    const droppedDeltaMs = Math.max(0, input.droppedMs - this.lastDroppedMs);
    this.lastDroppedMs = input.droppedMs;
    const tickDurationMs = input.phases.reduce(
      (total, phase) => total + phase.lastDurationMs,
      0
    );
    const hitch = tickDurationMs > this.options.stepMs || droppedDeltaMs > 0;
    if (!hitch && input.tick % this.options.sampleIntervalTicks !== 0) return undefined;

    const phases = input.phases.map(({id, lastDurationMs}) => ({
      id,
      durationMs: lastDurationMs
    }));
    const record: SimulationObservationRecord = {
      kind: hitch ? 'hitch' : 'sample',
      tick: input.tick,
      nowMs: input.nowMs,
      recordedAt: this.recordedAt(),
      tickDurationMs,
      droppedMs: input.droppedMs,
      droppedDeltaMs,
      eventsThisTick: input.eventsThisTick,
      entities: {...input.entities},
      slowestPhase: phases.reduce<SimulationPhaseObservation | undefined>(
        (slowest, phase) => !slowest || phase.durationMs > slowest.durationMs ? phase : slowest,
        undefined
      ),
      phases,
      vehicleMotion: input.vehicleMotion ? structuredClone(input.vehicleMotion) : undefined
    };
    this.latest = record;
    if (hitch) {
      this.recentHitches.push(record);
      if (this.recentHitches.length > 8) this.recentHitches.shift();
    }
    this.append(record);
    return record;
  }

  snapshot(): SimulationObservabilitySnapshot {
    return {
      roomId: this.options.roomId,
      buildId: this.options.buildId,
      journalFile: this.options.journalFile,
      latest: this.latest ? structuredClone(this.latest) : undefined,
      recentHitches: this.recentHitches.map((record) => structuredClone(record))
    };
  }

  close(): void {
    try {
      this.sink?.close();
    } catch (error) {
      this.options.onFailure?.(error);
    } finally {
      this.sink = undefined;
    }
  }

  private append(value: unknown): void {
    if (!this.sink) return;
    try {
      this.sink.append(value);
    } catch (error) {
      this.sink = undefined;
      this.options.onFailure?.(error);
    }
  }

  private recordedAt(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

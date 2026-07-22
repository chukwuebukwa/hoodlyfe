import type {PhysicsRuntimeDiagnostics} from './game/vehicles/vehicle-simulation-controller.ts';
import type {SimulationObservabilitySnapshot} from './game/observability/simulation-observability.ts';

export interface RuntimePhase {
  id: string;
  tick: number;
}

export interface RuntimeHealthSnapshot {
  ready: boolean;
  roomId?: string;
  fatal: boolean;
  shuttingDown: boolean;
  fatalContext?: string;
  fatalMessage?: string;
  currentPhase?: RuntimePhase;
  lastFailedPhase?: RuntimePhase;
  lastSuccessfulTick: number;
  lastSuccessfulTickAt?: number;
  lastSuccessfulTickAgeMs?: number;
  physics?: PhysicsRuntimeDiagnostics;
  observability: SimulationObservabilitySnapshot[];
}

export class RuntimeHealthMonitor {
  private ready = false;
  private roomId?: string;
  private fatal = false;
  private shuttingDown = false;
  private fatalContext?: string;
  private fatalMessage?: string;
  private currentPhase?: RuntimePhase;
  private lastFailedPhase?: RuntimePhase;
  private lastSuccessfulTick = 0;
  private lastSuccessfulTickAt?: number;
  private physics?: PhysicsRuntimeDiagnostics;
  private readonly observability = new Map<string, SimulationObservabilitySnapshot>();

  roomReady(roomId: string, now = Date.now()): void {
    this.ready = true;
    this.roomId = roomId;
    this.lastSuccessfulTickAt = now;
  }

  phaseChanged(phase: RuntimePhase | undefined): void {
    this.currentPhase = phase;
  }

  tickSucceeded(tick: number, physics?: PhysicsRuntimeDiagnostics, now = Date.now()): void {
    this.lastSuccessfulTick = tick;
    this.lastSuccessfulTickAt = now;
    this.lastFailedPhase = undefined;
    if (physics) this.physics = physics;
  }

  updateObservability(snapshot: SimulationObservabilitySnapshot): void {
    this.observability.set(snapshot.roomId, structuredClone(snapshot));
  }

  removeObservability(roomId: string): void {
    this.observability.delete(roomId);
  }

  fail(error: unknown, context: string, phase?: RuntimePhase): boolean {
    if (this.fatal) return false;
    this.fatal = true;
    this.fatalContext = context;
    this.fatalMessage = errorMessage(error);
    this.lastFailedPhase = phase ? {...phase} : this.currentPhase ? {...this.currentPhase} : undefined;
    return true;
  }

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  shouldFailForStall(now = Date.now(), thresholdMs = 5_000): boolean {
    return this.ready && !this.fatal && !this.shuttingDown &&
      this.lastSuccessfulTickAt !== undefined && now - this.lastSuccessfulTickAt > thresholdMs;
  }

  isHealthy(now = Date.now(), maximumTickAgeMs = 2_000): boolean {
    if (this.fatal || this.shuttingDown) return false;
    if (!this.ready || this.lastSuccessfulTickAt === undefined) return true;
    return now - this.lastSuccessfulTickAt <= maximumTickAgeMs;
  }

  snapshot(now = Date.now()): RuntimeHealthSnapshot {
    return {
      ready: this.ready,
      roomId: this.roomId,
      fatal: this.fatal,
      shuttingDown: this.shuttingDown,
      fatalContext: this.fatalContext,
      fatalMessage: this.fatalMessage,
      currentPhase: this.currentPhase ? {...this.currentPhase} : undefined,
      lastFailedPhase: this.lastFailedPhase ? {...this.lastFailedPhase} : undefined,
      lastSuccessfulTick: this.lastSuccessfulTick,
      lastSuccessfulTickAt: this.lastSuccessfulTickAt,
      lastSuccessfulTickAgeMs: this.lastSuccessfulTickAt === undefined
        ? undefined
        : Math.max(0, now - this.lastSuccessfulTickAt),
      physics: this.physics,
      observability: [...this.observability.values()].map((snapshot) => structuredClone(snapshot))
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SimulationPhaseContext {
  tick: number;
}

export interface SimulationPhaseDefinition<Context extends SimulationPhaseContext> {
  id: string;
  run: (context: Context) => void;
}

export interface SimulationPhaseDiagnostic {
  id: string;
  order: number;
  runs: number;
  lastTick: number;
  lastDurationMs: number;
  maxDurationMs: number;
  failures: number;
}

export interface SimulationPhasePipelineOptions {
  now?: () => number;
}

export class SimulationPhasePipeline<Context extends SimulationPhaseContext> {
  private readonly phases: ReadonlyArray<SimulationPhaseDefinition<Context>>;
  private readonly phaseDiagnostics: SimulationPhaseDiagnostic[];
  private readonly now: () => number;
  private running = false;

  constructor(
    phases: ReadonlyArray<SimulationPhaseDefinition<Context>>,
    options: SimulationPhasePipelineOptions = {}
  ) {
    validatePhases(phases);
    this.phases = [...phases];
    this.phaseDiagnostics = this.phases.map((phase, order) => ({
      id: phase.id,
      order,
      runs: 0,
      lastTick: 0,
      lastDurationMs: 0,
      maxDurationMs: 0,
      failures: 0
    }));
    this.now = options.now ?? defaultNow;
  }

  run(context: Context): void {
    if (this.running) {
      throw new Error('Simulation phase pipeline cannot run reentrantly.');
    }
    this.running = true;
    try {
      for (let index = 0; index < this.phases.length; index++) {
        const phase = this.phases[index];
        const diagnostic = this.phaseDiagnostics[index];
        const startedAt = this.now();
        try {
          phase.run(context);
        } catch (error) {
          diagnostic.failures += 1;
          throw error;
        } finally {
          const durationMs = Math.max(0, this.now() - startedAt);
          diagnostic.runs += 1;
          diagnostic.lastTick = context.tick;
          diagnostic.lastDurationMs = durationMs;
          diagnostic.maxDurationMs = Math.max(diagnostic.maxDurationMs, durationMs);
        }
      }
    } finally {
      this.running = false;
    }
  }

  diagnostics(): SimulationPhaseDiagnostic[] {
    return this.phaseDiagnostics.map((diagnostic) => ({...diagnostic}));
  }
}

function validatePhases<Context extends SimulationPhaseContext>(
  phases: ReadonlyArray<SimulationPhaseDefinition<Context>>
): void {
  if (phases.length === 0) {
    throw new RangeError('Simulation phase pipeline requires at least one phase.');
  }
  const ids = new Set<string>();
  for (const phase of phases) {
    if (!phase.id.trim()) throw new RangeError('Simulation phase IDs cannot be empty.');
    if (ids.has(phase.id)) {
      throw new RangeError(`Duplicate simulation phase ID: ${phase.id}`);
    }
    ids.add(phase.id);
  }
}

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

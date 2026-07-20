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
  onPhaseChange?: (phase: {id: string; tick: number} | undefined) => void;
}

export class SimulationPhasePipeline<Context extends SimulationPhaseContext> {
  private readonly phases: ReadonlyArray<SimulationPhaseDefinition<Context>>;
  private readonly phaseDiagnostics: SimulationPhaseDiagnostic[];
  private readonly now: () => number;
  private readonly onPhaseChange?: SimulationPhasePipelineOptions['onPhaseChange'];
  private running = false;
  private readonly active = {id: '', tick: 0};
  private phaseRunning = false;
  private failed?: {id: string; tick: number};

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
    this.onPhaseChange = options.onPhaseChange;
  }

  run(context: Context): void {
    if (this.running) {
      throw new Error('Simulation phase pipeline cannot run reentrantly.');
    }
    this.failed = undefined;
    this.running = true;
    try {
      for (let index = 0; index < this.phases.length; index++) {
        const phase = this.phases[index];
        const diagnostic = this.phaseDiagnostics[index];
        const startedAt = this.now();
        this.active.id = phase.id;
        this.active.tick = context.tick;
        this.phaseRunning = true;
        this.onPhaseChange?.(this.active);
        try {
          phase.run(context);
        } catch (error) {
          diagnostic.failures += 1;
          this.failed = {...this.active};
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
      this.phaseRunning = false;
      this.onPhaseChange?.(undefined);
      this.running = false;
    }
  }

  diagnostics(): SimulationPhaseDiagnostic[] {
    return this.phaseDiagnostics.map((diagnostic) => ({...diagnostic}));
  }

  activePhase(): {id: string; tick: number} | undefined {
    return this.phaseRunning ? {...this.active} : undefined;
  }

  lastFailedPhase(): {id: string; tick: number} | undefined {
    return this.failed ? {...this.failed} : undefined;
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

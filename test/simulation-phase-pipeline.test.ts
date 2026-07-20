import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DISTRICT_SIMULATION_PHASES} from '../server/game/world/district-simulation.ts';
import {
  SimulationPhasePipeline,
  type SimulationPhaseDefinition
} from '../server/game/world/simulation-phase-pipeline.ts';

interface Context {
  tick: number;
  order: string[];
}

test('phase pipeline executes exact order and records timing diagnostics', () => {
  const times = [0, 1, 1, 3];
  const phases: Array<SimulationPhaseDefinition<Context>> = [
    {id: 'first', run: (context) => context.order.push('first')},
    {id: 'second', run: (context) => context.order.push('second')}
  ];
  const pipeline = new SimulationPhasePipeline(phases, {now: () => times.shift() ?? 3});
  const context = {tick: 7, order: [] as string[]};
  pipeline.run(context);

  assert.deepEqual(context.order, ['first', 'second']);
  assert.deepEqual(pipeline.diagnostics(), [{
    id: 'first', order: 0, runs: 1, lastTick: 7,
    lastDurationMs: 1, maxDurationMs: 1, failures: 0
  }, {
    id: 'second', order: 1, runs: 1, lastTick: 7,
    lastDurationMs: 2, maxDurationMs: 2, failures: 0
  }]);
});

test('phase pipeline rejects invalid definitions and aborts after a failed phase', () => {
  assert.throws(() => new SimulationPhasePipeline<Context>([]), /at least one phase/);
  assert.throws(() => new SimulationPhasePipeline<Context>([
    {id: 'same', run: () => undefined},
    {id: 'same', run: () => undefined}
  ]), /Duplicate simulation phase ID/);

  const ran: string[] = [];
  const pipeline = new SimulationPhasePipeline<Context>([
    {id: 'first', run: () => ran.push('first')},
    {id: 'failure', run: () => { throw new Error('phase failed'); }},
    {id: 'never', run: () => ran.push('never')}
  ]);
  assert.throws(() => pipeline.run({tick: 4, order: []}), /phase failed/);
  assert.deepEqual(ran, ['first']);
  assert.equal(pipeline.diagnostics()[1].failures, 1);
  assert.equal(pipeline.diagnostics()[2].runs, 0);
});

test('phase pipeline reports active and failed phase identity', () => {
  const changes: Array<{id: string; tick: number} | undefined> = [];
  const pipeline = new SimulationPhasePipeline<Context>([{
    id: 'contacts',
    run: () => { throw new Error('contact failure'); }
  }], {onPhaseChange: (phase) => changes.push(phase)});
  assert.throws(() => pipeline.run({tick: 12, order: []}), /contact failure/);
  assert.deepEqual(changes, [{id: 'contacts', tick: 12}, undefined]);
  assert.equal(pipeline.activePhase(), undefined);
  assert.deepEqual(pipeline.lastFailedPhase(), {id: 'contacts', tick: 12});
});

test('phase pipeline rejects reentrant execution and remains usable afterward', () => {
  let pipeline: SimulationPhasePipeline<Context>;
  let recurse = true;
  pipeline = new SimulationPhasePipeline<Context>([{
    id: 'phase',
    run: (context) => {
      if (!recurse) return;
      recurse = false;
      pipeline.run(context);
    }
  }]);
  assert.throws(() => pipeline.run({tick: 1, order: []}), /reentrantly/);
  assert.doesNotThrow(() => pipeline.run({tick: 2, order: []}));
});

test('district phase contract keeps perception before one-shot event dispatch', () => {
  assert.equal(new Set(DISTRICT_SIMULATION_PHASES).size, DISTRICT_SIMULATION_PHASES.length);
  assert.ok(
    DISTRICT_SIMULATION_PHASES.indexOf('pedestrian-motion') <
    DISTRICT_SIMULATION_PHASES.indexOf('event-dispatch')
  );
  assert.deepEqual(DISTRICT_SIMULATION_PHASES, [
    'frame-state', 'simulation-activation', 'environment', 'vehicle-motion',
    'player-motion', 'crime-response', 'pedestrian-motion', 'dynamic-contacts',
    'history-capture', 'projectiles', 'world-effects', 'pickups',
    'incidents-missions', 'lifecycle', 'event-dispatch', 'snapshot-observability'
  ]);
});

test('district room delegates fixed-step ownership to DistrictSimulation', () => {
  const source = readFileSync('server/district-room.ts', 'utf8');
  assert.match(source, /new DistrictSimulation\(/);
  assert.match(source, /this\.simulation\.advance\(deltaTime\)/);
  assert.doesNotMatch(source, /private updateFixedStep\(/);
  assert.doesNotMatch(source, /private advanceSimulation\(/);
});

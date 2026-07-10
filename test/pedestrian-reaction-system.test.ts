import assert from 'node:assert/strict';
import test from 'node:test';
import {PedestrianReactionSystem} from '../server/game/pedestrians/pedestrian-reaction-system.ts';
import {createPedestrianRuntime} from '../server/game/pedestrians/pedestrian-runtime.ts';
import type {PedestrianObservation} from '../server/game/pedestrians/pedestrian-perception-system.ts';
import {NpcState} from '../server/state.ts';

test('danger reactions orient, flee to safety, recover, and restore ambient control', () => {
  const system = new PedestrianReactionSystem();
  const npc = createNpc();
  const runtime = createPedestrianRuntime(0, 0.35);
  const shot = stimulus({
    stimulusId: 'shot',
    stimulusKind: 'gunshot',
    x: 20,
    severity: 0.9,
    radius: 500,
    expiresAt: 1500
  });

  const orient = system.decide(npc, runtime, shot, 100);
  assert.deepEqual(orient, {objective: 'startle', angle: 0, speed: 0, fire: false, aimAngle: 0});
  assert.equal(runtime.reaction.phase, 'orient');
  const flee = system.decide(npc, runtime, shot, 600);
  assert.equal(flee?.objective, 'flee');
  assert.equal(flee?.angle, Math.PI);
  assert.equal(runtime.reaction.phase, 'respond');

  npc.x = -400;
  assert.equal(system.decide(npc, runtime, {kind: 'ambient'}, 2000)?.objective, 'flee');
  assert.equal(system.decide(npc, runtime, {kind: 'ambient'}, 4400)?.objective, 'recover');
  assert.equal(runtime.reaction.phase, 'recover');
  assert.equal(system.decide(npc, runtime, {kind: 'ambient'}, 5200), undefined);
  assert.equal(runtime.reaction.phase, 'none');
});

test('brave civilians investigate mild impacts and pause at the event', () => {
  const system = new PedestrianReactionSystem();
  const npc = createNpc();
  const runtime = createPedestrianRuntime(0, 0.75);
  const impact = stimulus({
    stimulusId: 'impact',
    stimulusKind: 'impact',
    x: 100,
    severity: 0.3,
    radius: 280,
    expiresAt: 1100
  });

  assert.equal(system.decide(npc, runtime, impact, 0)?.objective, 'startle');
  assert.deepEqual(system.decide(npc, runtime, impact, 500), {
    objective: 'investigate', angle: 0, speed: 58, fire: false, aimAngle: 0,
    targetX: 100, targetY: 0
  });
  npc.x = 40;
  assert.equal(system.decide(npc, runtime, impact, 700)?.speed, 0);
  assert.equal(system.decide(npc, runtime, {kind: 'ambient'}, 3000)?.objective, 'recover');
});

test('an equal repeated cue extends response without replaying the startle phase', () => {
  const system = new PedestrianReactionSystem();
  const npc = createNpc();
  const runtime = createPedestrianRuntime(0, 0.3);
  const shot = stimulus({
    stimulusId: 'continuous-shot',
    stimulusKind: 'gunshot',
    x: 50,
    severity: 0.9,
    radius: 500,
    expiresAt: 1400
  });
  system.decide(npc, runtime, shot, 0);
  assert.equal(system.decide(npc, runtime, shot, 500)?.objective, 'flee');
  const previousDeadline = runtime.reaction.responseUntil;
  const refreshed = {...shot, expiresAt: 5000};
  assert.equal(system.decide(npc, runtime, refreshed, 800)?.objective, 'flee');
  assert.ok(runtime.reaction.responseUntil > previousDeadline);
  assert.equal(runtime.reaction.phase, 'respond');
});

test('civilian reaction state does not override police tactical behavior', () => {
  const system = new PedestrianReactionSystem();
  const police = createNpc('police');
  assert.equal(
    system.decide(police, createPedestrianRuntime(0), stimulus({}), 0),
    undefined
  );
});

function stimulus(overrides: Partial<Extract<PedestrianObservation, {kind: 'stimulus'}>>): Extract<PedestrianObservation, {kind: 'stimulus'}> {
  return {
    kind: 'stimulus',
    stimulusId: 'stimulus',
    stimulusKind: 'gunshot',
    sourceId: 'shooter',
    x: 20,
    y: 0,
    severity: 0.9,
    radius: 500,
    expiresAt: 1500,
    distance: 20,
    angleAway: Math.PI,
    angleToward: 0,
    ...overrides
  };
}

function createNpc(kind: 'civilian' | 'police' = 'civilian'): NpcState {
  const npc = new NpcState();
  npc.id = kind;
  npc.kind = kind;
  return npc;
}

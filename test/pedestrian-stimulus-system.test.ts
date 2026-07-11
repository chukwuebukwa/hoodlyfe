import assert from 'node:assert/strict';
import test from 'node:test';
import {PedestrianBehaviorSystem} from '../server/game/pedestrians/pedestrian-behavior-system.ts';
import {PedestrianPerceptionSystem} from '../server/game/pedestrians/pedestrian-perception-system.ts';
import {createPedestrianRuntime} from '../server/game/pedestrians/pedestrian-runtime.ts';
import {PedestrianStimulusAdapter} from '../server/game/pedestrians/pedestrian-stimulus-adapter.ts';
import {PedestrianStimulusRegistry} from '../server/game/pedestrians/pedestrian-stimulus-registry.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {DistrictState, NpcState, VehicleState} from '../server/state.ts';
import type {GameEvent} from '../server/game/events/game-events.ts';

test('stimulus registry bounds, refreshes, scores, and expires world facts', () => {
  const registry = new PedestrianStimulusRegistry(2);
  const first = registry.register(input('impact', 'car', 80, 0, 0.4, 100, 0, 1000));
  const refreshed = registry.register(input('impact', 'car', 40, 0, 0.6, 100, 100, 1000));
  assert.equal(first.created, true);
  assert.equal(refreshed.created, false);
  assert.equal(refreshed.stimulus.id, first.stimulus.id);
  assert.equal(registry.size, 1);
  assert.equal(registry.nearest(0, 0, 100)?.x, 40);

  registry.register(input('death', 'victim', 90, 0, 1, 400, 200, 2000));
  assert.equal(registry.nearest(0, 0, 200)?.kind, 'death');
  registry.register(input('gunshot', 'shooter', 10, 0, 0.9, 500, 300, 1500));
  assert.equal(registry.size, 2);
  assert.equal(registry.snapshot().some((stimulus) => stimulus.id === first.stimulus.id), false);
  assert.equal(registry.expire(2300), 2);
  assert.equal(registry.size, 0);
});

test('event adapter converts combat and vehicle facts without duplicating weapon impacts', () => {
  const state = new DistrictState();
  const npc = new NpcState();
  npc.id = 'victim';
  npc.x = 30;
  npc.y = 40;
  state.npcs.set(npc.id, npc);
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.x = 90;
  vehicle.y = 100;
  state.vehicles.set(vehicle.id, vehicle);
  const registry = new PedestrianStimulusRegistry();
  const adapter = new PedestrianStimulusAdapter({state, registry});

  adapter.ingest([
    event({
      type: 'melee.started', playerId: 'shooter', weapon: 'bat', combo: 0, x: 1, y: 2
    }),
    event({type: 'weapon.fired', ownerId: 'shooter', ownerKind: 'player', weapon: 'shotgun', x: 1, y: 2}),
    event({type: 'damage.applied', targetId: npc.id, targetKind: 'npc', attackerId: 'shooter', amount: 25, remainingHealth: 25}),
    event({type: 'entity.killed', entityId: npc.id, entityKind: 'npc', attackerId: 'shooter'}),
    event({type: 'vehicle.damaged', vehicleId: vehicle.id, sourceId: 'wall', sourceKind: 'world', amount: 30, remainingHealth: 500}),
    event({type: 'vehicle.damaged', vehicleId: vehicle.id, sourceId: 'shooter', sourceKind: 'weapon', amount: 30, remainingHealth: 470}),
    event({type: 'vehicle.ignited', vehicleId: vehicle.id, sourceId: 'shooter', sourceKind: 'weapon', explodesAt: 6000}),
    event({
      type: 'vehicle.destroyed', vehicleId: vehicle.id, sourceId: 'shooter',
      sourceKind: 'weapon', occupantIds: []
    }),
    event({
      type: 'explosion.created', explosionId: 'explosion-1', kind: 'vehicle',
      sourceId: 'shooter', sourceKind: 'player', x: vehicle.x, y: vehicle.y, radius: 170
    })
  ]);

  assert.deepEqual(
    registry.snapshot().map((stimulus) => stimulus.kind),
    ['gunshot', 'injury', 'death', 'impact', 'fire', 'explosion']
  );
  const death = registry.snapshot().find((stimulus) => stimulus.kind === 'death');
  assert.ok(death);
  assert.deepEqual(
    {x: death.x, y: death.y, sourceId: death.sourceId, subjectId: death.subjectId},
    {x: 30, y: 40, sourceId: 'shooter', subjectId: 'victim'}
  );
});

test('staggered perception drives bravery-scaled civilian and police responses', () => {
  const state = new DistrictState();
  const registry = new PedestrianStimulusRegistry();
  const perception = new PedestrianPerceptionSystem({
    state,
    policeTarget: () => undefined,
    nearestStimulus: (x, y, nowMs) => registry.nearest(x, y, nowMs)
  });
  const behavior = new PedestrianBehaviorSystem({
    random: new DeterministicRandom('stimulus-behavior'),
    clock: () => ({tick: 1})
  });
  const civilian = npc('civilian');
  const runtime = createPedestrianRuntime(0, 0.7, 100);

  registry.register(input('impact', 'car', 100, 0, 0.3, 300, 0, 1000));
  assert.equal(perception.observe(civilian, runtime, 99).kind, 'ambient');
  const impact = perception.observe(civilian, runtime, 100);
  assert.equal(impact.kind, 'stimulus');
  assert.equal(behavior.decide(civilian, runtime, impact, 100).objective, 'startle');
  assert.equal(behavior.decide(civilian, runtime, impact, 600).objective, 'investigate');

  registry.register(input('gunshot', 'shooter', 20, 0, 0.9, 500, 300, 1200));
  const gunshot = perception.observe(civilian, runtime, 840);
  assert.equal(gunshot.kind, 'stimulus');
  assert.equal(behavior.decide(civilian, runtime, gunshot, 840).objective, 'startle');
  const civilianIntent = behavior.decide(civilian, runtime, gunshot, 1300);
  assert.equal(civilianIntent.objective, 'flee');
  assert.equal(civilianIntent.angle, Math.PI);

  const officer = npc('police');
  const policeRuntime = createPedestrianRuntime(0, 0.2);
  const policeObservation = perception.observe(officer, policeRuntime, 840);
  assert.equal(policeObservation.kind, 'stimulus');
  assert.equal(behavior.decide(officer, policeRuntime, policeObservation, 840).objective, 'investigate');
  assert.equal(perception.observe(civilian, runtime, 1500).kind, 'ambient');
});

function input(
  kind: 'gunshot' | 'impact' | 'injury' | 'death' | 'fire' | 'explosion',
  sourceId: string,
  x: number,
  y: number,
  severity: number,
  radius: number,
  occurredAt: number,
  lifetimeMs: number
) {
  return {
    kind,
    sourceId,
    subjectId: sourceId,
    x,
    y,
    severity,
    radius,
    occurredAt,
    lifetimeMs,
    dedupeKey: `${kind}:${sourceId}`,
    dedupeMs: 200
  };
}

function event(value: Record<string, unknown>): GameEvent {
  return {...value, tick: 1, nowMs: 1000} as unknown as GameEvent;
}

function npc(kind: 'civilian' | 'police'): NpcState {
  const value = new NpcState();
  value.id = kind;
  value.kind = kind;
  value.x = 0;
  value.y = 0;
  return value;
}

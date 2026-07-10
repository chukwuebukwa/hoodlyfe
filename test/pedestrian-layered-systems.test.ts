import assert from 'node:assert/strict';
import test from 'node:test';
import {PedestrianBehaviorSystem} from '../server/game/pedestrians/pedestrian-behavior-system.ts';
import {PedestrianLocomotionSystem} from '../server/game/pedestrians/pedestrian-locomotion-system.ts';
import {PedestrianNavigationSystem} from '../server/game/pedestrians/pedestrian-navigation-system.ts';
import {PedestrianPerceptionSystem} from '../server/game/pedestrians/pedestrian-perception-system.ts';
import {createPedestrianRuntime} from '../server/game/pedestrians/pedestrian-runtime.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {DistrictState, NpcState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('perception retains last-known threat position only for the panic window', () => {
  const state = new DistrictState();
  const npc = createNpc();
  const threat = new PlayerState();
  threat.id = 'threat';
  threat.x = -20;
  threat.y = 0;
  state.players.set(threat.id, threat);
  const runtime = createPedestrianRuntime(1);
  const perception = new PedestrianPerceptionSystem({
    state,
    policeTarget: () => undefined
  });
  perception.rememberThreat(runtime, threat.id, 5000);

  assert.deepEqual(perception.observe(npc, runtime, 1000), {
    kind: 'threat',
    sourceId: 'threat',
    x: -20,
    y: 0,
    angleAway: 0,
    angleToward: Math.PI,
    distance: 20
  });
  state.players.delete(threat.id);
  assert.deepEqual(perception.observe(npc, runtime, 4000), {
    kind: 'threat',
    sourceId: 'threat',
    x: -20,
    y: 0,
    angleAway: 0,
    angleToward: Math.PI,
    distance: 20
  });
  assert.deepEqual(perception.observe(npc, runtime, 5000), {kind: 'ambient'});
  assert.equal(runtime.threatId, '');
  assert.equal(Number.isNaN(runtime.lastKnownThreatX), true);
});

test('navigation detours police locomotion without altering target aim or fire cadence', () => {
  const npc = createNpc('police');
  const runtime = createPedestrianRuntime(0);
  runtime.avoidAngle = Math.PI / 2;
  runtime.avoidUntil = 2000;
  const behavior = new PedestrianBehaviorSystem({
    random: new DeterministicRandom('police-layer'),
    clock: () => ({tick: 1})
  });
  const observation = {
    kind: 'police' as const,
    response: {
      pursuit: {
        officerId: npc.id,
        suspectId: 'suspect',
        lastKnownX: 200,
        lastKnownY: 0,
        lastSeenAt: 1000,
        searchUntil: 9000,
        mode: 'pursuit' as const
      },
      canSeeTarget: true,
      targetDistance: 200
    }
  };
  const first = behavior.decide(npc, runtime, observation, 1000);
  const navigation = new PedestrianNavigationSystem({
    random: new DeterministicRandom('police-layer-navigation'),
    clock: () => ({tick: 1})
  });
  assert.equal(first.objective, 'pursue');
  assert.equal(first.angle, 0);
  assert.equal(navigation.resolveAngle(npc, runtime, first, 1000), Math.PI / 2);
  assert.equal(first.aimAngle, 0);
  assert.equal(first.fire, true);
  assert.equal(behavior.decide(npc, runtime, observation, 1200).fire, false);
  assert.equal(behavior.decide(npc, runtime, observation, 1680).fire, true);
});

test('navigation recovery is deterministic and locomotion resolves axes independently', () => {
  const firstRuntime = createPedestrianRuntime(0);
  const secondRuntime = createPedestrianRuntime(0);
  const first = new PedestrianNavigationSystem({
    random: new DeterministicRandom('navigation-layer'),
    clock: () => ({tick: 44})
  });
  const second = new PedestrianNavigationSystem({
    random: new DeterministicRandom('navigation-layer'),
    clock: () => ({tick: 44})
  });
  first.recoverFromBlock(firstRuntime, 'civilian', 0, 1000);
  second.recoverFromBlock(secondRuntime, 'civilian', 0, 1000);
  assert.equal(firstRuntime.avoidAngle, secondRuntime.avoidAngle);
  assert.equal(firstRuntime.avoidUntil, 1250);
  assert.ok(firstRuntime.avoidAngle >= -Math.PI && firstRuntime.avoidAngle <= Math.PI);

  const world = {
    canOccupy: (x: number) => x <= 0
  } as unknown as CollisionMap;
  const locomotion = new PedestrianLocomotionSystem(world, 10);
  const npc = createNpc();
  assert.equal(locomotion.move(npc, Math.PI / 4, 60, 1), true);
  assert.equal(npc.x, 0);
  assert.ok(npc.y > 0);
});

function createNpc(kind: 'civilian' | 'police' = 'civilian'): NpcState {
  const npc = new NpcState();
  npc.id = kind;
  npc.kind = kind;
  npc.x = 0;
  npc.y = 0;
  return npc;
}

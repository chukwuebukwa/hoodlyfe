import assert from 'node:assert/strict';
import test from 'node:test';
import type {MissionEncounterDefinition} from '../shared/content/mission-catalog.ts';
import {
  MissionEncounterSystem,
  type MissionEncounterActorSpawn
} from '../server/game/missions/mission-encounter-system.ts';

const definition: MissionEncounterDefinition = {
  spawnMinDistance: 100,
  spawnMaxDistance: 200,
  spawnCadenceMs: 100,
  interWaveDelayMs: 500,
  waves: [
    {count: 1, health: 50, weapon: 'pistol', fireCooldownMs: 900},
    {count: 2, health: 80, weapon: 'smg', fireCooldownMs: 700}
  ]
};

test('mission encounter owns bounded waves, target assignment, contribution, and cleanup', () => {
  const actors = new Map<string, {alive: boolean; x: number; y: number}>();
  const spawns: MissionEncounterActorSpawn[] = [];
  const targets = new Map<string, string>();
  const system = new MissionEncounterSystem({
    spawnActor: (spawn) => {
      spawns.push(spawn);
      actors.set(spawn.actorId, {alive: true, x: 0, y: 0});
    },
    actorState: (actorId) => actors.get(actorId),
    setActorTarget: (actorId, playerId) => targets.set(actorId, playerId)
  });
  assert.equal(system.start('mission', 0, 0, 120, definition, 0), true);
  assert.equal(system.start('mission', 0, 0, 120, definition, 0), false);

  const first = system.update('mission', [
    {playerId: 'far', connected: true, alive: true, x: 500, y: 0},
    {playerId: 'near', connected: true, alive: true, x: 50, y: 0}
  ], 0);
  assert.equal(first?.wave, 1);
  assert.equal(first?.remaining, 1);
  assert.equal(first?.contested, true);
  assert.equal(targets.get('mission:hostile:1'), 'near');

  actors.get('mission:hostile:1')!.alive = false;
  system.observeEvents([{
    type: 'entity.killed',
    tick: 1,
    nowMs: 100,
    entityId: 'mission:hostile:1',
    entityKind: 'npc',
    attackerId: 'near'
  }]);
  assert.equal(system.update('mission', [], 599)?.wave, 1);
  assert.equal(system.update('mission', [], 600)?.wave, 2);
  assert.equal(spawns.at(-1)?.health, 80);
  system.update('mission', [], 700);
  assert.equal(spawns.length, 3);

  for (const actorId of ['mission:hostile:2', 'mission:hostile:3']) {
    actors.get(actorId)!.alive = false;
    system.observeEvents([{
      type: 'entity.killed',
      tick: 2,
      nowMs: 800,
      entityId: actorId,
      entityKind: 'npc',
      attackerId: 'near'
    }]);
  }
  const complete = system.update('mission', [], 800);
  assert.equal(complete?.complete, true);
  assert.equal(complete?.remaining, 0);
  assert.deepEqual(complete?.contributions, [{playerId: 'near', defeats: 3}]);
  assert.deepEqual(system.remove('mission'), [
    'mission:hostile:1',
    'mission:hostile:2',
    'mission:hostile:3'
  ]);
  assert.equal(system.get('mission'), undefined);
});

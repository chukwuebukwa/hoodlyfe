import assert from 'node:assert/strict';
import test from 'node:test';
import {selectMeleeTargets, type MeleeTargetCandidate} from '../server/game/combat/melee-hit-policy.ts';
import {WEAPONS} from '../shared/content/weapon-catalog.ts';

test('melee target policy rejects range, rear arc, and occluded candidates', () => {
  const strike = WEAPONS.fists.strikes[0];
  const candidates: MeleeTargetCandidate[] = [
    candidate('front', 'npc', 38, 0, 10, true),
    candidate('rear', 'npc', -20, 0, 10, true),
    candidate('far', 'npc', 60, 0, 10, true),
    candidate('wall', 'npc', 25, 0, 10, false)
  ];

  assert.deepEqual(
    selectMeleeTargets(0, 0, 0, strike, candidates).map((target) => target.id),
    ['front']
  );
});

test('melee target policy is deterministic and enforces family target caps', () => {
  const fistTargets = selectMeleeTargets(0, 0, 0, WEAPONS.fists.strikes[0], [
    candidate('b', 'npc', 25, 4),
    candidate('a', 'player', 25, -4)
  ]);
  assert.equal(fistTargets.length, 1);
  assert.equal(fistTargets[0]?.id, 'a');

  const batTargets = selectMeleeTargets(0, 0, 0, WEAPONS.bat.strikes[0], [
    candidate('ped-4', 'npc', 40, 8),
    candidate('ped-3', 'npc', 38, -8),
    candidate('ped-2', 'npc', 34, 5),
    candidate('ped-1', 'player', 30, 0),
    candidate('car-2', 'vehicle', 45, -5, 20),
    candidate('car-1', 'vehicle', 42, 5, 20)
  ]);
  assert.equal(batTargets.filter((target) => target.kind !== 'vehicle').length, 3);
  assert.equal(batTargets.filter((target) => target.kind === 'vehicle').length, 1);
  assert.equal(batTargets.some((target) => target.id === 'ped-4'), false);
  assert.equal(batTargets.find((target) => target.kind === 'vehicle')?.id, 'car-1');
});

test('a vehicle blocks bat contact against pedestrians directly behind it', () => {
  const targets = selectMeleeTargets(0, 0, 0, WEAPONS.bat.strikes[0], [
    candidate('car', 'vehicle', 24, 0, 18),
    candidate('behind-car', 'npc', 43, 0, 10),
    candidate('clear-side', 'npc', 38, 35, 10)
  ]);
  assert.equal(targets.some((target) => target.id === 'car'), true);
  assert.equal(targets.some((target) => target.id === 'behind-car'), false);
  assert.equal(targets.some((target) => target.id === 'clear-side'), true);
});

test('a wreck remains an occluder without becoming a melee damage target', () => {
  const targets = selectMeleeTargets(0, 0, 0, WEAPONS.bat.strikes[0], [
    candidate('wreck', 'vehicle', 18, 0, 12, true, false),
    candidate('behind-wreck', 'npc', 34, 0, 8)
  ]);

  assert.deepEqual(targets, []);
});

function candidate(
  id: string,
  kind: MeleeTargetCandidate['kind'],
  x: number,
  y: number,
  radius = 10,
  lineOfSight = true,
  targetable = true
): MeleeTargetCandidate {
  return {id, kind, x, y, radius, lineOfSight, targetable};
}

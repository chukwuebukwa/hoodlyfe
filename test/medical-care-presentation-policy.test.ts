import assert from 'node:assert/strict';
import test from 'node:test';
import {projectMedicalCare} from '../src/game/medical/medical-care-presentation-policy.ts';
import type {NetworkPlayer} from '../src/game/types.ts';

test('medical care UI projects affordability, selected care, and living lockout', () => {
  const player = createPlayer();
  assert.deepEqual(projectMedicalCare(player), {
    care: 'public',
    label: 'Public Ward',
    publicDisabled: false,
    traumaDisabled: true
  });

  player.cash = 250;
  assert.equal(projectMedicalCare(player).traumaDisabled, false);
  player.respawnCare = 'trauma';
  assert.deepEqual(projectMedicalCare(player), {
    care: 'trauma',
    label: 'Trauma Care',
    publicDisabled: true,
    traumaDisabled: true
  });
  player.alive = true;
  assert.equal(projectMedicalCare(player).traumaDisabled, true);
});

function createPlayer(): NetworkPlayer {
  return {
    id: 'driver',
    name: 'Driver',
    x: 0,
    y: 0,
    angle: 0,
    health: 0,
    wanted: 0,
    cash: 0,
    alive: false,
    respawnAt: 4200,
    respawnCare: 'public',
    vehicleId: '',
    vehicleSeat: -1,
    action: '',
    actionUntil: 0,
    actionVehicleId: '',
    weapon: 'pistol',
    ammoPistol: 12,
    ammoSmg: 0,
    ammoShotgun: 0,
    appearance: {} as never
  };
}

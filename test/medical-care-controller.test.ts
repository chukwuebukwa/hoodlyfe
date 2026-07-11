import assert from 'node:assert/strict';
import test from 'node:test';
import {medicalCareDefinition} from '../shared/content/medical-care.ts';
import {medicalTreatmentQuote} from '../shared/content/street-services.ts';
import {StreetEconomyController} from '../server/game/economy/street-economy-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {MedicalCareController} from '../server/game/medical/medical-care-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {
  containsPoint,
  interiorDefinition
} from '../shared/content/interior-catalog.ts';

test('medical care registers safe facilities and completes one paid nearest-hospital admission', () => {
  const fixture = createFixture(500);
  fixture.medical.initialize();
  fixture.medical.initialize();
  const facilities = [...fixture.state.services.values()].filter((service) => (
    service.kind === 'hospital'
  ));
  assert.equal(facilities.length, 2);
  assert.ok(Math.hypot(
    facilities[0].x - facilities[1].x,
    facilities[0].y - facilities[1].y
  ) >= 320);
  const mercy = facilities.find((facility) => facility.id === 'hospital-mercy');
  const southside = facilities.find((facility) => facility.id === 'hospital-southside');
  assert.ok(mercy && southside);
  const hospital = interiorDefinition(mercy.spaceId);
  assert.ok(hospital?.recoveryAnchor);
  assert.equal(containsPoint(hospital.bounds, mercy.x, mercy.y), true);
  assert.equal(hospital.obstacles.some((obstacle) => containsPoint(obstacle, mercy.x, mercy.y)), false);
  const southsideInterior = interiorDefinition(southside.spaceId);
  assert.equal(southsideInterior?.id, 'southside-clinic');
  assert.ok(southsideInterior?.recoveryAnchor);
  assert.equal(containsPoint(southsideInterior.bounds, southside.x, southside.y), true);
  assert.equal(
    southsideInterior.obstacles.some((obstacle) => containsPoint(obstacle, southside.x, southside.y)),
    false
  );

  fixture.tick = 7;
  fixture.medical.begin(fixture.player, facilities[0].x, facilities[0].y, 1000);
  assert.equal(fixture.player.respawnCare, 'public');
  assert.equal(fixture.player.respawnAt, 1000 + medicalCareDefinition('public').delayMs);
  assert.equal(fixture.medical.select(fixture.player.id, 'trauma', 1300), true);
  assert.equal(fixture.player.cash, 250);
  assert.equal(fixture.player.respawnCare, 'trauma');
  assert.equal(fixture.player.respawnAt, 1000 + medicalCareDefinition('trauma').delayMs);
  assert.equal(fixture.medical.select(fixture.player.id, 'trauma', 1400), true);
  assert.equal(fixture.player.cash, 250, 'Repeated choice must not charge again.');

  const plan = fixture.medical.complete(fixture.player.id, fixture.player.respawnAt);
  assert.equal(plan.care, 'trauma');
  assert.equal(plan.restoreAmmo, true);
  assert.equal(plan.spaceId, hospital.id);
  assert.deepEqual({x: plan.x, y: plan.y}, {
    x: hospital.recoveryAnchor.x,
    y: hospital.recoveryAnchor.y
  });
  assert.ok(Math.hypot(plan.x - facilities[0].x, plan.y - facilities[0].y) <= 100);
});

test('insufficient trauma funds preserve public fallback and living treatment is authoritative', () => {
  const fixture = createFixture(0);
  fixture.medical.initialize();
  fixture.medical.begin(fixture.player, fixture.player.x, fixture.player.y, 2000);
  const publicAt = fixture.player.respawnAt;
  assert.equal(fixture.medical.select(fixture.player.id, 'trauma', 2200), true);
  assert.equal(fixture.player.respawnCare, 'public');
  assert.equal(fixture.player.respawnAt, publicAt);
  assert.match(fixture.notices.at(-1)?.message ?? '', /Not enough cash/);

  const hospital = [...fixture.state.services.values()].find((service) => (
    service.kind === 'hospital'
  ));
  assert.ok(hospital);
  fixture.player.alive = true;
  fixture.player.respawnCare = '';
  fixture.player.respawnAt = 0;
  fixture.player.x = hospital.x;
  fixture.player.y = hospital.y;
  fixture.player.spaceId = hospital.spaceId;
  fixture.player.health = 40;
  fixture.player.cash = 500;
  fixture.tick = 12;
  const quote = medicalTreatmentQuote(fixture.player.health);
  assert.equal(fixture.medical.canTreat(fixture.player), true);
  assert.equal(fixture.medical.treat(fixture.player.id, hospital.id, 3000), true);
  assert.equal(fixture.player.health, 100);
  assert.equal(fixture.player.cash, 500 - quote);

  fixture.player.health = 50;
  fixture.player.wanted = 1;
  const balance = fixture.player.cash;
  assert.equal(fixture.medical.treat(fixture.player.id, hospital.id, 3100), true);
  assert.equal(fixture.player.health, 50);
  assert.equal(fixture.player.cash, balance);
  assert.match(fixture.notices.at(-1)?.message ?? '', /Lose police heat/);
});

function createFixture(cash: number) {
  const state = new DistrictState();
  const world = CollisionMap.load();
  const events = new GameEventStream();
  const player = new PlayerState();
  player.id = 'driver';
  player.cash = cash;
  player.x = world.spawn.x;
  player.y = world.spawn.y;
  player.alive = false;
  state.players.set(player.id, player);
  let tick = 0;
  const notices: Array<{message: string; tone: string}> = [];
  const economy = new StreetEconomyController({
    state,
    events,
    clock: () => ({tick})
  });
  const medical = new MedicalCareController({
    state,
    world,
    economy,
    clock: () => ({tick}),
    notice: (_playerId, message, tone) => notices.push({message, tone})
  });
  return {
    state,
    world,
    player,
    medical,
    notices,
    get tick() { return tick; },
    set tick(value: number) { tick = value; }
  };
}

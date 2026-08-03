import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatHitboxHistory} from '../server/game/combat/combat-hitbox-history.ts';
import {ProjectileController} from '../server/game/combat/projectile-controller.ts';
import {GameEventStream, type ProjectileImpactEvent} from '../server/game/events/game-events.ts';
import {BulletState, DistrictState, PlayerState} from '../server/state.ts';
import type {StreetPropController} from '../server/game/props/street-prop-controller.ts';

test('physical projectile catch-up hits historical actors once and removes resolved authority', () => {
  const setup = fixture(() => false);
  const target = player('target', 100, 0);
  setup.state.players.set(target.id, target);
  setup.capture(1_000);
  setup.capture(1_200);
  const bullet = setup.bullet();

  const result = setup.controller.catchUp({
    bullet,
    requestedServerShotTimeMs: 1_000,
    nowMs: 1_200,
    excludedIds: new Set(['shooter'])
  });
  assert.equal(result.rewindMs, 200);
  assert.equal(result.resolved, true);
  assert.equal(setup.state.bullets.has(bullet.id), false);
  assert.equal(setup.playerHits, 1);
  assert.ok(bullet.x > 80 && bullet.x < 100, 'Receipt pose stops at the historical hitbox entry.');
  assert.deepEqual(setup.impacts(), [{
    type: 'projectile.impact',
    tick: 36,
    nowMs: 1_200,
    projectileId: 'bullet-1',
    weapon: 'pistol',
    targetKind: 'player',
    targetId: 'target',
    x: bullet.x,
    y: bullet.y,
    angle: 0,
    surfaceId: 'street-ground'
  }]);

  setup.controller.catchUp({
    bullet,
    requestedServerShotTimeMs: 1_000,
    nowMs: 1_200,
    excludedIds: new Set(['shooter'])
  });
  assert.equal(setup.playerHits, 1, 'A correlated authoritative projectile resolves once.');
  assert.deepEqual(setup.impacts(), [], 'A resolved projectile emits its impact once.');
});

test('physical projectile catch-up keeps an unresolved bullet at its server-age position', () => {
  const setup = fixture(() => false);
  setup.capture(1_000);
  setup.capture(1_200);
  const bullet = setup.bullet();
  const result = setup.controller.catchUp({
    bullet,
    requestedServerShotTimeMs: 1_000,
    nowMs: 1_200,
    excludedIds: new Set(['shooter'])
  });
  assert.equal(result.resolved, false);
  assert.ok(Math.abs(bullet.x - 162) < 1e-9);
  assert.equal(bullet.createdAt, 1_000);
  assert.equal(setup.state.bullets.has(bullet.id), true);
  assert.deepEqual(setup.impacts(), []);
});

test('current static obstruction wins before a historical target and consumes catch-up', () => {
  const setup = fixture((x) => x >= 60);
  const target = player('target', 100, 0);
  setup.state.players.set(target.id, target);
  setup.capture(1_000);
  setup.capture(1_200);
  const result = setup.controller.catchUp({
    bullet: setup.bullet(),
    requestedServerShotTimeMs: 1_000,
    nowMs: 1_200,
    excludedIds: new Set(['shooter'])
  });
  assert.equal(result.resolved, true);
  assert.equal(setup.playerHits, 0);
  assert.deepEqual(setup.impacts().map((event) => event.targetKind), ['world']);
});

test('live projectile impact stops at the target hitbox entry', () => {
  const setup = fixture(() => false);
  setup.state.players.set('target', player('target', 34, 0));
  const bullet = setup.bullet();

  setup.controller.update(bullet, bullet.id, 0.016, 1_216);

  const [impact] = setup.impacts();
  assert.equal(impact.targetKind, 'player');
  assert.ok(Math.abs(impact.x - 19) < 1e-9);
});

test('police use a reduced-damage pistol without changing the player pistol', () => {
  const setup = fixture(() => false);
  const target = player('target', 34, 0);
  target.wanted = 2;
  setup.state.players.set(target.id, target);
  const bullet = setup.bullet();
  bullet.ownerId = 'officer';
  bullet.ownerKind = 'police';

  setup.controller.update(bullet, bullet.id, 0.016, 1_216);

  assert.deepEqual(setup.playerDamages, [13]);
});

test('live projectiles stop on replicated street props and publish the prop impact', () => {
  let propHits = 0;
  const prop = {id: 'prototype-prop-1'};
  const setup = fixture(
    () => false,
    {
      firstSegmentHit: () => ({prop, progress: 0.5}),
      damage: () => {
        propHits++;
        return true;
      }
    } as unknown as StreetPropController
  );
  const bullet = setup.bullet();

  setup.controller.update(bullet, bullet.id, 0.016, 1_216);

  assert.equal(propHits, 1);
  assert.equal(setup.state.bullets.has(bullet.id), false);
  assert.deepEqual(setup.impacts().map((impact) => ({
    targetKind: impact.targetKind,
    targetId: impact.targetId
  })), [{targetKind: 'prop', targetId: prop.id}]);
});

function fixture(
  blocked: (x: number, y: number) => boolean,
  props?: StreetPropController
): {
  state: DistrictState;
  controller: ProjectileController;
  capture: (time: number) => void;
  bullet: () => BulletState;
  impacts: () => ProjectileImpactEvent[];
  readonly playerDamages: number[];
  readonly playerHits: number;
} {
  const state = new DistrictState();
  const shooter = player('shooter', 0, 0);
  state.players.set(shooter.id, shooter);
  const history = new CombatHitboxHistory();
  const events = new GameEventStream();
  let playerHits = 0;
  const playerDamages: number[] = [];
  const controller = new ProjectileController({
    state,
    world: {isBlockedAt: blocked} as any,
    history,
    props,
    access: {occupants: () => []} as any,
    vehicles: {
      weaponDamage: (damage: number) => damage,
      damage: () => undefined
    } as any,
    damage: {
      player: (_target: PlayerState, amount: number) => {
        playerHits++;
        playerDamages.push(amount);
      },
      npc: () => undefined
    } as any,
    events,
    clock: () => ({tick: 36}),
    queryPlayers: () => [...state.players.values()],
    queryNpcs: () => [],
    queryVehicles: () => [],
    remove: (id) => state.bullets.delete(id)
  });
  return {
    state,
    controller,
    impacts: () => events.drain().filter((event): event is ProjectileImpactEvent => (
      event.type === 'projectile.impact'
    )),
    capture: (serverTimeMs) => history.capture({
      serverTick: Math.round(serverTimeMs / 33),
      serverTimeMs,
      worldCollisionRevision: 1,
      players: state.players.values(),
      npcs: state.npcs.values(),
      vehicles: state.vehicles.values()
    }),
    bullet: () => {
      const bullet = new BulletState();
      bullet.id = 'bullet-1';
      bullet.ownerId = shooter.id;
      bullet.x = 18;
      bullet.y = 0;
      bullet.angle = 0;
      bullet.weapon = 'pistol';
      bullet.createdAt = 1_200;
      state.bullets.set(bullet.id, bullet);
      return bullet;
    },
    get playerHits() {
      return playerHits;
    },
    get playerDamages() {
      return playerDamages;
    }
  };
}

function player(id: string, x: number, y: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}

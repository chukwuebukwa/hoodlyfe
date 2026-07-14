import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatHitboxHistory} from '../server/game/combat/combat-hitbox-history.ts';
import {ProjectileController} from '../server/game/combat/projectile-controller.ts';
import {BulletState, DistrictState, PlayerState} from '../server/state.ts';

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

  setup.controller.catchUp({
    bullet,
    requestedServerShotTimeMs: 1_000,
    nowMs: 1_200,
    excludedIds: new Set(['shooter'])
  });
  assert.equal(setup.playerHits, 1, 'A correlated authoritative projectile resolves once.');
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
});

function fixture(blocked: (x: number, y: number) => boolean): {
  state: DistrictState;
  controller: ProjectileController;
  capture: (time: number) => void;
  bullet: () => BulletState;
  readonly playerHits: number;
} {
  const state = new DistrictState();
  const shooter = player('shooter', 0, 0);
  state.players.set(shooter.id, shooter);
  const history = new CombatHitboxHistory();
  let playerHits = 0;
  const controller = new ProjectileController({
    state,
    world: {isBlockedAt: blocked} as any,
    history,
    access: {occupants: () => []} as any,
    vehicles: {
      weaponDamage: (damage: number) => damage,
      damage: () => undefined
    } as any,
    damage: {
      player: () => {
        playerHits++;
      },
      npc: () => undefined
    } as any,
    queryPlayers: () => [],
    queryNpcs: () => [],
    queryVehicles: () => [],
    remove: (id) => state.bullets.delete(id)
  });
  return {
    state,
    controller,
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

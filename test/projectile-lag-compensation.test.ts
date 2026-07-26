import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatHitboxHistory} from '../server/game/combat/combat-hitbox-history.ts';
import {ProjectileController} from '../server/game/combat/projectile-controller.ts';
import {GameEventStream, type ProjectileImpactEvent} from '../server/game/events/game-events.ts';
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

function fixture(blocked: (x: number, y: number) => boolean): {
  state: DistrictState;
  controller: ProjectileController;
  capture: (time: number) => void;
  bullet: () => BulletState;
  impacts: () => ProjectileImpactEvent[];
  readonly playerHits: number;
} {
  const state = new DistrictState();
  const shooter = player('shooter', 0, 0);
  state.players.set(shooter.id, shooter);
  const history = new CombatHitboxHistory();
  const events = new GameEventStream();
  let playerHits = 0;
  const controller = new ProjectileController({
    state,
    world: {isBlockedAt: blocked, traceSegment: fakeTraceSegment(blocked)} as any,
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

function fakeTraceSegment(blocked: (x: number, y: number) => boolean) {
  return (ax: number, ay: number, bx: number, by: number) => {
    const distance = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(distance));
    for (let step = 1; step <= steps; step++) {
      if (!blocked(ax + (bx - ax) * (step / steps), ay + (by - ay) * (step / steps))) continue;
      let low = (step - 1) / steps;
      let high = step / steps;
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (blocked(ax + (bx - ax) * mid, ay + (by - ay) * mid)) high = mid;
        else low = mid;
      }
      return {t: high, x: ax + (bx - ax) * high, y: ay + (by - ay) * high, normalX: 0, normalY: 0};
    }
    return undefined;
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatHitboxHistory} from '../server/game/combat/combat-hitbox-history.ts';
import {NpcState, PlayerState, VehicleState} from '../server/state.ts';

test('combat history interpolates same-lifecycle humanoids and applies the public rewind cap', () => {
  const history = new CombatHitboxHistory();
  const target = player('target', 100, 0);
  capture(history, 1, 1_000, [target]);
  target.y = 100;
  capture(history, 2, 1_100, [target]);

  const interpolated = history.querySegment({
    requestedServerTimeMs: 1_050,
    nowMs: 1_100,
    startX: 0,
    startY: 50,
    endX: 200,
    endY: 50
  });
  assert.equal(interpolated?.hit?.id, 'target');
  assert.equal(interpolated?.hit?.y, 50);
  assert.equal(interpolated?.rewindMs, 50);

  capture(history, 3, 1_500, [target]);
  const capped = history.querySegment({
    requestedServerTimeMs: 0,
    nowMs: 1_500,
    startX: 0,
    startY: 100,
    endX: 200,
    endY: 100
  });
  assert.equal(capped?.effectiveServerTimeMs, 1_300);
  assert.equal(capped?.clamped, true);
});

test('combat history does not interpolate across despawn and respawn lifecycle boundaries', () => {
  const history = new CombatHitboxHistory();
  const target = player('target', 50, 0);
  capture(history, 1, 1_000, [target]);
  target.alive = false;
  capture(history, 2, 1_033, [target]);
  target.alive = true;
  target.x = 150;
  capture(history, 3, 1_066, [target]);

  assert.equal(history.querySegment({
    requestedServerTimeMs: 1_040,
    nowMs: 1_066,
    startX: 100,
    startY: 0,
    endX: 200,
    endY: 0
  })?.hit, undefined);
  assert.equal(history.querySegment({
    requestedServerTimeMs: 1_066,
    nowMs: 1_066,
    startX: 100,
    startY: 0,
    endX: 200,
    endY: 0
  })?.hit?.lifecycleRevision, 2);
});

test('combat history uses oriented catalog boxes and deterministic nearest-hit ordering', () => {
  const history = new CombatHitboxHistory();
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.kind = 'sedan';
  vehicle.x = 100;
  vehicle.y = 100;
  vehicle.angle = Math.PI / 2;
  const near = player('near', 60, 0);
  const far = new NpcState();
  far.id = 'far';
  far.x = 140;
  far.y = 0;
  capture(history, 1, 1_000, [near], [far], [vehicle]);

  const miss = history.querySegment({
    requestedServerTimeMs: 1_000,
    nowMs: 1_000,
    startX: 60,
    startY: 130,
    endX: 140,
    endY: 130,
    kinds: new Set(['vehicle'])
  });
  assert.equal(miss?.hit, undefined, 'A segment inside the old radius must miss the rotated box.');

  const hit = history.querySegment({
    requestedServerTimeMs: 1_000,
    nowMs: 1_000,
    startX: 0,
    startY: 0,
    endX: 200,
    endY: 0
  });
  assert.equal(hit?.hit?.id, 'near');
  assert.ok((hit?.hit?.progress ?? 1) < 0.3);
});

test('combat history retains at most the configured frame and time windows', () => {
  const history = new CombatHitboxHistory({historyTicks: 3, retentionMs: 60});
  const target = player('target', 0, 0);
  for (let tick = 1; tick <= 5; tick++) capture(history, tick, tick * 33, [target]);
  assert.equal(history.size(), 2);
  assert.equal(history.oldestTimeMs(), 132);
});

function capture(
  history: CombatHitboxHistory,
  serverTick: number,
  serverTimeMs: number,
  players: PlayerState[] = [],
  npcs: NpcState[] = [],
  vehicles: VehicleState[] = []
): void {
  history.capture({
    serverTick,
    serverTimeMs,
    worldCollisionRevision: 1,
    players,
    npcs,
    vehicles
  });
}

function player(id: string, x: number, y: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}

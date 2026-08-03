import assert from 'node:assert/strict';
import test from 'node:test';
import {StreetPropController} from '../server/game/props/street-prop-controller.ts';
import {DistrictState, StreetPropState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {streetPropDefinition} from '../shared/content/street-props.ts';

test('street props do not add a hardcoded spawn showcase', () => {
  const {state, controller} = fixture();
  controller.initialize();

  assert.equal(state.streetProps.size, 0);
});

test('street prop segment hits select the nearest live prop', () => {
  const {state, controller} = fixture();
  const prop = seedProp(state);
  controller.initialize();
  const hit = controller.firstSegmentHit(50, -104, 140, -104, 'street-ground');

  assert.equal(hit?.prop, prop);
  assert.ok(hit && hit.progress > 0 && hit.progress < 1);
});

test('street prop damage advances frames, destroys, and resets', () => {
  const {state, controller} = fixture();
  const prop = seedProp(state);
  controller.initialize();

  controller.damage(prop, 16, Math.PI / 2, 1_000);
  assert.equal(prop.damageStage, 1);
  assert.equal(prop.hitSequence, 1);
  assert.equal(prop.hitAngle, Math.PI / 2);

  controller.damage(prop, 100, 0, 2_000);
  assert.equal(prop.damageStage, 2);
  assert.equal(prop.destroyed, true);
  assert.equal(prop.resetAt, 10_000);
  assert.equal(controller.firstSegmentHit(50, -104, 140, -104, 'street-ground'), undefined);

  controller.update(9_999);
  assert.equal(prop.destroyed, true);
  controller.update(10_000);
  assert.equal(prop.destroyed, false);
  assert.equal(prop.damageStage, 0);
  assert.equal(prop.health, prop.maxHealth);
});

test('vehicle contact forgives parking speed and destroys props at driving speed', () => {
  const {state, controller} = fixture();
  const prop = seedProp(state);
  controller.initialize();
  const vehicle = new VehicleState();
  vehicle.id = 'vehicle-1';
  vehicle.surfaceId = prop.surfaceId;
  vehicle.x = prop.x;
  vehicle.y = prop.y;
  vehicle.linvelX = 70;
  state.vehicles.set(vehicle.id, vehicle);

  controller.update(1_000);
  assert.equal(prop.destroyed, false);
  assert.equal(vehicle.linvelX, 0);

  vehicle.linvelX = 130;
  controller.update(1_100);
  assert.equal(prop.destroyed, true);
  assert.equal(prop.damageStage, 2);
  assert.equal(prop.hitAngle, 0);
});

test('vehicle impact sweep destroys a prop crossed between simulation ticks', () => {
  const {state, controller} = fixture();
  const prop = seedProp(state);
  controller.initialize();
  const vehicle = new VehicleState();
  vehicle.id = 'vehicle-sweep';
  vehicle.surfaceId = prop.surfaceId;
  vehicle.x = prop.x - 100;
  vehicle.y = prop.y;
  state.vehicles.set(vehicle.id, vehicle);

  controller.update(1_000);
  vehicle.x = prop.x + 100;
  vehicle.linvelX = 180;
  controller.update(1_100);

  assert.equal(prop.destroyed, true);
});

test('slow vehicle contact blocks movement without destroying the prop', () => {
  const {state, controller} = fixture();
  const prop = seedProp(state);
  controller.initialize();
  const vehicle = new VehicleState();
  vehicle.id = 'vehicle-bump';
  vehicle.surfaceId = prop.surfaceId;
  vehicle.x = prop.x - 70;
  vehicle.y = prop.y;
  state.vehicles.set(vehicle.id, vehicle);

  controller.update(1_000);
  vehicle.x = prop.x - 20;
  vehicle.linvelX = 60;
  controller.update(1_100);

  assert.equal(prop.destroyed, false);
  assert.equal(vehicle.x, prop.x - 70);
  assert.equal(vehicle.linvelX, 0);
});

test('street props distribute deterministically along non-road district edges', () => {
  const world = CollisionMap.load();
  const first = new DistrictState();
  const second = new DistrictState();
  new StreetPropController({state: first, world}).initialize();
  new StreetPropController({state: second, world}).initialize();

  assert.ok(first.streetProps.size >= 300);
  assert.ok(first.streetProps.size <= 500);
  assert.deepEqual([...first.streetProps.keys()], [...second.streetProps.keys()]);
  const families = new Set(
    [...first.streetProps.values()].map((prop) => streetPropDefinition(prop.definitionId)?.family)
  );
  assert.deepEqual(families, new Set(['dumpster', 'hydrant', 'trash-can']));
  assert.ok([...first.streetProps.values()].every((prop) => !world.isRoadAt(prop.x, prop.y)));
  assert.ok([...first.streetProps.values()].every((prop) => (
    world.surfaces.surfaceIdsAt(prop.x, prop.y, 'prop').includes(prop.surfaceId) &&
    world.canOccupy(
      prop.x,
      prop.y,
      streetPropDefinition(prop.definitionId)?.hitRadius ?? 0,
      prop.surfaceId,
      'prop'
    )
  )));
});

function seedProp(state: DistrictState): StreetPropState {
  const definition = streetPropDefinition('dumpster.dark-green');
  assert.ok(definition);
  const prop = new StreetPropState();
  prop.id = 'test-prop-1';
  prop.definitionId = definition.id;
  prop.surfaceId = 'street-ground';
  prop.x = 96;
  prop.y = -104;
  prop.maxHealth = definition.maxHealth;
  prop.health = definition.maxHealth;
  state.streetProps.set(prop.id, prop);
  return prop;
}

function fixture(): {state: DistrictState; controller: StreetPropController} {
  const state = new DistrictState();
  const world = {
    spawnFor: () => ({x: 0, y: 0, surfaceId: 'street-ground'}),
    canOccupy: () => true,
    openPointNear: () => ({x: 200, y: 200, surfaceId: 'street-ground'})
  };
  return {
    state,
    controller: new StreetPropController({state, world: world as never})
  };
}

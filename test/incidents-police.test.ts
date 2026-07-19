import assert from 'node:assert/strict';
import test from 'node:test';
import {IncidentRegistry} from '../server/game/incidents/incident-registry.ts';
import {WitnessSystem} from '../server/game/incidents/witness-system.ts';
import {PursuitMemory} from '../server/game/police/pursuit-memory.ts';
import {WantedSystem} from '../server/game/wanted/wanted-system.ts';

test('incidents deduplicate rapid damage and report after the selected witness delay', () => {
  const incidents = new IncidentRegistry(4);
  const first = incidents.register({
    kind: 'assault',
    suspectId: 'driver',
    victimId: 'civilian-1',
    x: 100,
    y: 100,
    nowMs: 1000
  });
  const duplicate = incidents.register({
    kind: 'assault',
    suspectId: 'driver',
    victimId: 'civilian-1',
    x: 101,
    y: 100,
    nowMs: 1500
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.incident.id, first.incident.id);

  const report = new WitnessSystem().selectReporter(first.incident, [
    {id: 'civilian-1', kind: 'civilian', x: 102, y: 100, alive: true},
    {id: 'civilian-2', kind: 'civilian', x: 130, y: 100, alive: true},
    {id: 'police-1', kind: 'police', x: 180, y: 100, alive: true}
  ], () => true);

  assert.equal(report?.witnessId, 'police-1');
  assert.equal(report?.delayMs, 120);
  assert.equal(incidents.scheduleReport(first.incident.id, report!.witnessId, 1120), true);
  assert.equal(incidents.dueReports(1119).length, 0);
  assert.deepEqual(incidents.dueReports(1120).map((incident) => incident.id), [first.incident.id]);
  assert.equal(incidents.markReported(first.incident.id, 1120), true);
  assert.equal(incidents.activeCount, 0);
});

test('unwitnessed incidents expire without creating wanted heat', () => {
  const incidents = new IncidentRegistry();
  const wanted = new WantedSystem();
  const {incident} = incidents.register({
    kind: 'vehicle-theft',
    suspectId: 'driver',
    x: 0,
    y: 0,
    nowMs: 0
  });
  wanted.noteCrime(incident.suspectId, 0);

  assert.equal(new WitnessSystem().selectReporter(incident, [], () => false), undefined);
  incidents.expire(12_001);
  assert.equal(incidents.size, 0);
  assert.deepEqual(wanted.get('driver'), {heat: 0, level: 0});
});

test('vehicle theft requires an immediate direct police witness', () => {
  const incidents = new IncidentRegistry();
  const {incident} = incidents.register({
    kind: 'vehicle-theft',
    suspectId: 'driver',
    x: 100,
    y: 100,
    nowMs: 1000
  });
  const witnesses = new WitnessSystem();

  assert.equal(witnesses.selectReporter(incident, [
    {id: 'civilian-1', kind: 'civilian', x: 110, y: 100, alive: true}
  ], () => true), undefined);
  assert.equal(witnesses.selectReporter(incident, [
    {id: 'police-1', kind: 'police', x: 110, y: 100, alive: true}
  ], () => false), undefined);
  assert.deepEqual(witnesses.selectReporter(incident, [
    {id: 'civilian-1', kind: 'civilian', x: 105, y: 100, alive: true},
    {id: 'police-1', kind: 'police', x: 120, y: 100, alive: true}
  ], () => true), {
    witnessId: 'police-1',
    witnessKind: 'police',
    delayMs: 0,
    lineOfSight: true,
    distance: 20
  });
});

test('wanted heat escalates by severity and decays only while police are absent', () => {
  const wanted = new WantedSystem(1000, 500, 12);
  wanted.noteCrime('driver', 100);
  assert.deepEqual(wanted.report('driver', 28, 200), {heat: 28, level: 1});
  assert.deepEqual(wanted.tryDecay('driver', 1400, true), {heat: 28, level: 1});
  assert.deepEqual(wanted.tryDecay('driver', 1400, false), {heat: 16, level: 0});
  assert.deepEqual(wanted.tryDecay('driver', 1900, false), {heat: 16, level: 0});
  wanted.reset('driver');
  assert.deepEqual(wanted.get('driver'), {heat: 0, level: 0});
});

test('police pursue observed positions, search last-known positions, then forget', () => {
  const memory = new PursuitMemory(8000);
  assert.equal(memory.assignSearch('police-2', 'driver', 20, 30, 500).mode, 'search');
  assert.equal(memory.observe('police-1', 'driver', 40, 60, 1000).mode, 'pursuit');
  assert.deepEqual(memory.search('police-1', 'driver', 5000), {
    officerId: 'police-1',
    suspectId: 'driver',
    lastKnownX: 40,
    lastKnownY: 60,
    lastSeenAt: 1000,
    searchUntil: 9000,
    mode: 'search'
  });
  assert.equal(memory.search('police-1', 'driver', 9001), undefined);
  assert.equal(memory.get('police-1'), undefined);
});

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  cycleStation,
  initialStationForVehicle,
  projectVehicleRadio
} from '../src/game/audio/radio-policy.ts';

describe('radio policy', () => {
  it('cycles between available station and off', () => {
    assert.equal(cycleStation('station-0', 1), 'station-1');
    assert.equal(cycleStation('station-1', 1), 'station-3');
    assert.equal(cycleStation('station-3', 1), 'radio-off');
    assert.equal(cycleStation('radio-off', 1), 'station-0');
    assert.equal(cycleStation('station-0', -1), 'radio-off');
  });

  it('projects vehicle entry and exit separately from playback', () => {
    const entering = projectVehicleRadio('', 'car-1', 'station-0');
    assert.equal(entering.inVehicle, true);
    assert.equal(entering.vehicleChanged, true);
    assert.equal(entering.station.id, 'station-0');

    const exiting = projectVehicleRadio('car-1', '', 'station-0');
    assert.equal(exiting.inVehicle, false);
    assert.equal(exiting.vehicleChanged, true);
  });

  it('assigns a playable initial station for a vehicle', () => {
    assert.notEqual(initialStationForVehicle('traffic-7'), 'radio-off');
    assert.equal(initialStationForVehicle(''), 'radio-off');
  });
});

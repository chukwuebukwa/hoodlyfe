import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertVehicleInteractionReplayActivationGate,
  runVehicleInteractionReplaySoak,
  VEHICLE_INTERACTION_REPLAY_PROFILES
} from './support/vehicle-interaction-replay-soak.ts';

for (const [index, profile] of VEHICLE_INTERACTION_REPLAY_PROFILES.entries()) {
  test(`vehicle interaction replay survives ${profile.id} impairment`, async () => {
    const first = await runVehicleInteractionReplaySoak(profile, 0x6a09e667 + index * 1009);
    assertVehicleInteractionReplayActivationGate(first);

    const second = await runVehicleInteractionReplaySoak(profile, 0x6a09e667 + index * 1009);
    assert.deepEqual(second.deterministicTrace, first.deterministicTrace);
    assert.equal(second.acceptedSnapshots, first.acceptedSnapshots);
    assert.equal(second.retransmissions, first.retransmissions);
  });
}

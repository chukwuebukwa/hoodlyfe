# Networked Vehicle Physics Research

## Decision

NOCK0 should use a server-authoritative, fixed-tick vehicle simulation with client-side prediction and saved-input resimulation for the local driver's car. Remote vehicles should use timestamped snapshot interpolation. Collision damage, occupancy, hijacking state, and final dynamic contact resolution remain authoritative.

This is the production pattern documented by Valve's Source networking design, Unreal Engine's Networked Physics resimulation mode, and Glenn Fiedler's networked physics work.

## What The Player Sees

- The local car responds to throttle and steering in the same render frame.
- Static-world collision is predicted using the same geometry and simulation function as the server.
- The client stores every fixed-tick input and resulting state until the server acknowledges it.
- A server correction is compared with the client state from the matching tick, not the current visual pose.
- Material errors rewind to the authoritative historical state and replay all unacknowledged inputs.
- Rendering smooths the post-resimulation visual offset; the physics state itself is not gradually pulled toward an invalid intermediate state.
- Remote cars render slightly in the past between two timestamped snapshots. Extrapolation is short and bounded.

## Saved Move Contract

Each local fixed-tick move should contain:

```ts
interface VehicleMove {
  sequence: number;
  clientTick: number;
  deltaMs: number;
  steering: number;
  throttle: number;
  predicted: VehiclePhysicsState;
}

interface VehiclePhysicsState {
  x: number;
  y: number;
  angle: number;
  speed: number;
}
```

The server snapshot should include `acknowledgedMoveSequence`, `serverTick`, and the complete canonical vehicle state. Inputs should carry redundant recent moves so one dropped message does not freeze steering.

## Reconciliation

1. Find the saved move matching the acknowledged sequence.
2. Compare canonical position, angle, and speed with that historical predicted state.
3. Ignore errors under separately tuned thresholds.
4. For a material error, restore the canonical state at that tick.
5. Replay all newer saved moves through the exact shared simulation step.
6. Replace the current physics state with the replay result.
7. Preserve the previous rendered transform as a visual error offset and decay that offset quickly.
8. Hard snap only for invalid history, teleports, interior transitions, destroyed vehicles, or extreme divergence.

Correction thresholds must be measured in latency and packet-loss tests. A single position threshold is insufficient; heading and speed divergence can make a car feel wrong before position error is large.

## Collision Model

The current server uses oriented boxes for vehicle-to-vehicle contacts but a circular radius for static-world occupancy. The old F3 ring visualized that radius, not the oriented vehicle body.

Production collision should converge on one shared oriented body:

- Catalog-owned half-length and half-width for every vehicle type.
- Swept oriented-box movement against static map collision to prevent high-speed tunneling.
- Oriented-box contacts for vehicle-to-vehicle collision.
- Fixed simulation tick and bounded substeps for fast vehicles.
- The same pure collision queries in browser and server builds.
- Server-owned impulses, damage zones, occupant injury, and destruction.

The local client may predict a provisional dynamic contact using the latest buffered pose of a nearby vehicle, but the server result wins. Prediction should prioritize contacts involving the owned car; simulating every traffic car ahead of authority is both expensive and unstable.

## Debug Contract

F3 should never present one unlabeled shape when prediction is active:

- Cyan: local predicted physics body.
- Purple: latest server-authoritative body.
- Remote render pose: timestamped interpolation result, when enabled.
- Panel: position error, angular error, speed error, acknowledged move, pending move count, resimulation count, and hard correction count.

A gap between predicted and authoritative bodies is expected under latency. A persistent or growing gap indicates a simulation mismatch, collision mismatch, missing input acknowledgement, or clock/tick error.

## Rollout

1. Static world parity: completed for the existing radius occupancy model.
2. Dual predicted/authoritative F3 bodies: completed.
3. Fixed-tick saved vehicle moves and applied-state acknowledgement: completed.
4. Rewind and replay with post-simulation visual error smoothing: completed.
5. Shared oriented-box static collision and swept movement for player-controlled vehicles: completed.
6. Extend the shared sweep to autonomous traffic and police locomotion.
7. Provisional local dynamic contacts and server correction.
8. Packet-loss, jitter, and latency matrix with automated correction budgets.

### Implemented Reconciliation Thresholds

- Position error greater than `2` world pixels.
- Heading error greater than `0.02` radians.
- Speed error greater than `3` world units per second.
- Position divergence greater than `180` world pixels forces a hard visual correction.
- Missing or expired history fails closed with one authoritative reset.

These are initial measured-policy values, not permanent tuning constants. F3 exposes resimulation count, hard corrections, acknowledged move sequence, and pending move count so latency simulation can tune them with evidence.

## Acceptance Budgets

- Steering visual response: same display frame as sampled input.
- Ordinary correction: no visible hard snap at 150 ms RTT and 2% packet loss.
- Static collision: predicted contact begins before authoritative confirmation and does not penetrate the map.
- Resimulation: bounded history and CPU cost at the target display rate.
- Remote vehicles: no unbounded extrapolation; stale entities freeze or fade after the configured horizon.
- F3: predicted and authoritative poses remain independently visible.

## Sources

- Valve, Source Multiplayer Networking: https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- Epic Games, Networked Physics Overview: https://dev.epicgames.com/documentation/en-us/unreal-engine/networked-physics-overview
- Epic Games, Chaos Modular Vehicles Quickstart: https://dev.epicgames.com/documentation/en-us/unreal-engine/chaos-modular-vehicles-quickstart
- Glenn Fiedler, Networked Physics: https://gafferongames.com/post/networked_physics_2004/
- Glenn Fiedler, State Synchronization: https://gafferongames.com/post/state_synchronization/
- Glenn Fiedler, Snapshot Interpolation: https://gafferongames.com/post/snapshot_interpolation/

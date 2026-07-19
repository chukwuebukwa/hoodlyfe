import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {Client, type Room} from 'colyseus.js';
import {
  DEBUG_SNAPSHOT_MESSAGE,
  DEBUG_SUBSCRIBE_MESSAGE,
  type DebugSnapshot
} from '../shared/protocol/debug.ts';
import {
  MISSION_ABANDON_MESSAGE,
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_START_MESSAGE
} from '../shared/protocol/missions.ts';
import {GAME_NOTICE_MESSAGE} from '../shared/protocol/notices.ts';
import {AUDIO_EVENTS_MESSAGE} from '../shared/protocol/audio-events.ts';
import {COMBAT_PROTOCOL_VERSION} from '../shared/protocol/combat-fire.ts';
import {
  COMBAT_FIRE_MESSAGE,
  COMBAT_FIRE_RECEIPT_MESSAGE,
  type CombatFireReceipt
} from '../shared/protocol/combat-fire.ts';
import {ON_FOOT_INPUT_MESSAGE} from '../shared/protocol/on-foot-input.ts';
import {
  APPEARANCE_RESULT_MESSAGE,
  APPEARANCE_UPDATE_MESSAGE,
  type AppearanceResultMessage
} from '../shared/protocol/appearance.ts';
import {
  WARDROBE_REQUEST_MESSAGE,
  WARDROBE_STATE_MESSAGE,
  type WardrobeStateMessage
} from '../shared/protocol/wardrobe.ts';
import {DEVELOPMENT_WARDROBE_GRANTS} from '../shared/content/wardrobe-catalog.ts';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';
import type {DistrictNetworkState} from '../src/game/types.ts';
import {CollisionMap} from '../server/world-map.ts';
import {PedestrianPathPlanner} from '../server/game/pedestrians/pedestrian-path-planner.ts';
import {vehicleConfig} from '../server/game/vehicles/vehicle-config.ts';
import {AMBIENT_TRAFFIC_TARGET} from '../server/game/population/district-population-controller.ts';
import {
  STREAMED_CIVILIAN_RECORDS,
  STREAMED_POLICE_RECORDS,
  STREAMED_TRAFFIC_RECORDS
} from '../server/game/population/population-streaming-controller.ts';
import {INTERIORS, STREET_SPACE_ID} from '../shared/content/interior-catalog.ts';

const hasLocalAssets = existsSync(resolve('public/assets/maps/district-map.json'));

test('two clients can use weapons, share cars, drive, fight, and respawn cleanly', {skip: !hasLocalAssets, timeout: 45_000}, async (context) => {
  const port = 28_000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: {...process.env, GAME_PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  server.stdout?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  context.after(() => stopServer(server));
  await waitForServer(port, server, () => serverOutput);
  const world = CollisionMap.load();

  const joinedAppearance = {...cloneAppearance(), outfitName: 'Night Run', topColor: 'red' as const};
  const first = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate<DistrictNetworkState>('district', {
    name: 'Driver One',
    appearance: joinedAppearance
  });
  const second = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate<DistrictNetworkState>('district', {name: 'Driver Two'});
  const debugSnapshots: DebugSnapshot[] = [];
  const appearanceResults: AppearanceResultMessage[] = [];
  const firstWardrobeStates: WardrobeStateMessage[] = [];
  const secondWardrobeStates: WardrobeStateMessage[] = [];
  const fireReceipts: CombatFireReceipt[] = [];
  first.onMessage<DebugSnapshot>(DEBUG_SNAPSHOT_MESSAGE, (snapshot) => debugSnapshots.push(snapshot));
  second.onMessage<DebugSnapshot>(DEBUG_SNAPSHOT_MESSAGE, () => undefined);
  first.onMessage(AUDIO_EVENTS_MESSAGE, () => undefined);
  second.onMessage(AUDIO_EVENTS_MESSAGE, () => undefined);
  first.onMessage<CombatFireReceipt>(
    COMBAT_FIRE_RECEIPT_MESSAGE,
    (receipt) => fireReceipts.push(receipt)
  );
  first.onMessage<AppearanceResultMessage>(
    APPEARANCE_RESULT_MESSAGE,
    (result) => appearanceResults.push(result)
  );
  first.onMessage<WardrobeStateMessage>(
    WARDROBE_STATE_MESSAGE,
    (state) => firstWardrobeStates.push(state)
  );
  second.onMessage<WardrobeStateMessage>(
    WARDROBE_STATE_MESSAGE,
    (state) => secondWardrobeStates.push(state)
  );
  await delay(250);
  assert.equal(debugSnapshots.length, 0, 'Debug snapshots require an explicit client subscription.');
  first.send(DEBUG_SUBSCRIBE_MESSAGE);
  second.send(DEBUG_SUBSCRIBE_MESSAGE);
  first.onMessage(GAME_NOTICE_MESSAGE, () => undefined);
  second.onMessage(GAME_NOTICE_MESSAGE, () => undefined);
  context.after(async () => {
    await Promise.allSettled([first.leave(), second.leave()]);
  });

  await waitUntil(() => first.state.players.size === 2 && second.state.players.size === 2);
  await waitUntil(() => second.state.players.get(second.sessionId)?.armor === 25);
  await waitUntil(() => first.state.players.get(second.sessionId)?.armor === 25);
  await waitUntil(() => (
    first.state.services.size === 1 && first.state.npcs.size > 0 && first.state.vehicles.size > 0
  ));
  assert.ok(first.state.npcs.size < 13 + STREAMED_CIVILIAN_RECORDS + STREAMED_POLICE_RECORDS);
  assert.ok(first.state.vehicles.size < AMBIENT_TRAFFIC_TARGET + 3 + STREAMED_TRAFFIC_RECORDS);
  assert.equal(first.state.services.size, 1);
  assert.deepEqual([...first.state.services.values()].map((service) => service.kind), ['repair']);
  assert.equal(first.state.services.has('clothing-store'), false);
  assert.equal(first.state.services.has('hospital-mercy'), false);
  assert.ok([...first.state.vehicles.values()].every((vehicle) => {
    const maximumHealth = vehicleConfig(vehicle.kind).maxHealth;
    return vehicle.health === maximumHealth && vehicle.maxHealth === maximumHealth &&
      vehicle.engineDamage === 0;
  }));
  assert.equal(first.state.players.get(first.sessionId)?.name, 'Driver One');
  assert.equal(first.state.players.get(first.sessionId)?.armor, 25);
  assert.equal(first.state.players.get(second.sessionId)?.armor, 25);
  assert.equal(second.state.players.get(second.sessionId)?.armor, 25);
  assert.equal(second.state.players.get(first.sessionId)?.name, 'Driver One');
  assert.equal(first.state.players.get(first.sessionId)?.appearance.outfitName, 'Night Run');
  assert.equal(second.state.players.get(first.sessionId)?.appearance.topColor, 'red');

  first.send(WARDROBE_REQUEST_MESSAGE);
  await waitUntil(() => firstWardrobeStates.length === 1);
  await delay(60);
  assert.equal(secondWardrobeStates.length, 0, 'Wardrobe state must be private to its requester.');
  assert.deepEqual(firstWardrobeStates[0].ownedItemIds, DEVELOPMENT_WARDROBE_GRANTS);
  assert.equal(firstWardrobeStates[0].developmentGrants, true);
  const updatedAppearance = {...joinedAppearance, outfitName: 'Blue Shift', topColor: 'blue' as const};
  first.send(APPEARANCE_UPDATE_MESSAGE, updatedAppearance);
  await waitUntil(() => appearanceResults.length === 1);
  assert.equal(appearanceResults[0].status, 'applied');
  await waitUntil(() => second.state.players.get(first.sessionId)?.appearance.topColor === 'blue');
  assert.equal(first.state.players.get(first.sessionId)?.appearance.outfitName, 'Blue Shift');
  assert.equal(first.state.players.get(first.sessionId)?.weapon, 'pistol');
  await waitUntil(() => debugSnapshots.length > 0);
  const debugSnapshot = debugSnapshots.at(-1);
  assert.ok(debugSnapshot && debugSnapshot.tick > 0);
  assert.equal(
    debugSnapshot.spatialEntities,
    debugSnapshot.players + debugSnapshot.npcs + debugSnapshot.vehicles
  );
  assert.equal(debugSnapshot.deferredCommands, 0);
  assert.ok(debugSnapshot.populationStreaming);
  const streamedPopulation = debugSnapshot.populationStreaming;
  const activePopulation = streamedPopulation.activePedestrians + streamedPopulation.activeTraffic;
  assert.ok(streamedPopulation.hotActors + streamedPopulation.warmActors <= activePopulation);
  assert.equal(
    streamedPopulation.dormantActors,
    streamedPopulation.potentialPedestrians + streamedPopulation.potentialTraffic - activePopulation
  );
  assert.ok(streamedPopulation.deferredVisibleActors >= 0);
  assert.ok(streamedPopulation.lookaheadAnchors >= 0);
  assert.ok(streamedPopulation.interestClusters >= 1);
  assert.ok(streamedPopulation.quotaPressureClusters >= 0);
  assert.ok(streamedPopulation.quotaRebalances >= 0);
  assert.ok(streamedPopulation.worldMinute >= 0 && streamedPopulation.worldMinute < 24 * 60);
  assert.ok(streamedPopulation.populationDayWeight >= 0);
  assert.ok(streamedPopulation.populationDayWeight <= 1);
  assert.ok(streamedPopulation.zoneActivity.length > 0);
  assert.ok(streamedPopulation.profileDeferredActors >= 0);
  assert.ok(streamedPopulation.profileRebalances >= 0);

  first.send(MISSION_START_MESSAGE);
  await waitUntil(() => first.state.missions.size === 1 && second.state.missions.size === 1);
  const mission = [...first.state.missions.values()][0];
  assert.equal(mission.phase, 'forming');
  assert.equal(mission.leaderId, first.sessionId);
  assert.equal(mission.objectiveKind, 'acquire-vehicle');
  assert.equal(mission.objectiveCount, 3);
  assert.equal(mission.checkpointCount, 0);
  assert.ok(first.state.vehicles.has(mission.targetVehicleId));
  assert.equal(mission.participants.size, 1);
  second.send(MISSION_JOIN_MESSAGE, {missionId: mission.id});
  await waitUntil(() => first.state.missions.get(mission.id)?.participants.size === 2);
  assert.equal(second.state.missions.get(mission.id)?.participants.has(second.sessionId), true);
  first.send(MISSION_LAUNCH_MESSAGE, {missionId: mission.id});
  await waitUntil(() => first.state.missions.get(mission.id)?.phase === 'steal');
  assert.equal(second.state.missions.get(mission.id)?.phase, 'steal');
  assert.ok((first.state.missions.get(mission.id)?.remainingMs ?? 0) > 170_000);
  first.send(MISSION_ABANDON_MESSAGE, {missionId: mission.id});
  await waitUntil(() => first.state.missions.get(mission.id)?.phase === 'failed');

  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'smg');
  const smgAmmo = first.state.players.get(first.sessionId)?.ammoSmg;
  assert.equal(smgAmmo, 240);
  const correlatedCommand = {
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence: 1,
    clientSampleTimeMs: first.state.serverTimeMs,
    controlledEntityId: first.sessionId,
    aimAngle: safeFireAngle(first, first.sessionId, world),
    predictedSpawnIds: [9_001]
  };
  first.send(COMBAT_FIRE_MESSAGE, correlatedCommand);
  await waitUntil(() => fireReceipts.length === 1);
  assert.equal(fireReceipts[0].status, 'accepted');
  assert.equal(fireReceipts[0].projectiles[0]?.clientSpawnId, 9_001);
  assert.ok(fireReceipts[0].rewindMs >= 0 && fireReceipts[0].rewindMs <= 200);
  await waitUntil(() => first.state.players.get(first.sessionId)?.ammoSmg === 239);
  first.send(COMBAT_FIRE_MESSAGE, correlatedCommand);
  await waitUntil(() => fireReceipts.length === 2);
  assert.equal(fireReceipts[1].reason, 'stale-sequence');
  assert.equal(first.state.players.get(first.sessionId)?.ammoSmg, 239);
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'shotgun');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'rocket');
  assert.equal(first.state.players.get(first.sessionId)?.ammoRocket, 4);
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'grenade');
  assert.equal(first.state.players.get(first.sessionId)?.ammoGrenade, 2);
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'molotov');
  assert.equal(first.state.players.get(first.sessionId)?.ammoMolotov, 3);
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'fists');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'bat');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'pistol');

  const trafficStarts = new Map(
    [...first.state.vehicles.entries()]
      .filter(([, vehicle]) => vehicle.traffic)
      .map(([id, vehicle]) => [id, {x: vehicle.x, y: vehicle.y}])
  );
  assert.ok(trafficStarts.size > 0 && trafficStarts.size < AMBIENT_TRAFFIC_TARGET + STREAMED_TRAFFIC_RECORDS);
  await waitUntil(() => [...trafficStarts.entries()].some(([id, start]) => {
    const vehicle = first.state.vehicles.get(id);
    return Boolean(vehicle && Math.hypot(vehicle.x - start.x, vehicle.y - start.y) > 10);
  }), 4000);

  first.send('interact');
  await waitUntil(() => {
    const player = first.state.players.get(first.sessionId);
    return Boolean(player?.vehicleId) && player?.vehicleSeat === 0;
  });
  const vehicleId = first.state.players.get(first.sessionId)?.vehicleId;
  assert.ok(vehicleId);
  assert.equal(first.state.players.get(first.sessionId)?.vehicleSeat, 0);
  second.send('interact');
  await waitUntil(() => {
    const localPassenger = second.state.players.get(second.sessionId);
    const remotePassenger = first.state.players.get(second.sessionId);
    return localPassenger?.vehicleId === vehicleId && localPassenger.vehicleSeat === 1 &&
      remotePassenger?.vehicleId === vehicleId && remotePassenger.vehicleSeat === 1;
  });
  assert.equal(first.state.players.get(second.sessionId)?.vehicleSeat, 1);
  second.send('cycleWeapon', {direction: 1});
  await waitUntil(() => second.state.players.get(second.sessionId)?.weapon === 'smg');
  const passengerAim = safeFireAngle(second, second.sessionId, world);
  second.send('aim', {angle: passengerAim});
  await waitUntil(() => Math.abs(
    Math.atan2(
      Math.sin((second.state.players.get(second.sessionId)?.angle ?? 0) - passengerAim),
      Math.cos((second.state.players.get(second.sessionId)?.angle ?? 0) - passengerAim)
    )
  ) < 0.05);
  second.send('shoot');
  await waitUntil(() => second.state.players.get(second.sessionId)?.ammoSmg === 239);
  second.send('cycleWeapon', {direction: -1});
  await waitUntil(() => second.state.players.get(second.sessionId)?.weapon === 'pistol');
  second.send('interact');
  await waitUntil(() => !second.state.players.get(second.sessionId)?.vehicleId);
  const vehicleStart = first.state.vehicles.get(vehicleId);
  assert.ok(vehicleStart);
  const startVehiclePosition = {x: vehicleStart.x, y: vehicleStart.y};
  first.send('input', {x: 0, y: -1});
  await delay(650);
  first.send('input', {x: 0, y: 0});
  await waitUntil(() => {
    const vehicle = first.state.vehicles.get(vehicleId);
    return Boolean(vehicle && Math.hypot(vehicle.x - startVehiclePosition.x, vehicle.y - startVehiclePosition.y) > 12);
  });
  first.send('interact');
  await waitUntil(() => !first.state.players.get(first.sessionId)?.vehicleId);

  const playerBeforeMove = first.state.players.get(first.sessionId);
  assert.ok(playerBeforeMove);
  const startY = playerBeforeMove.y;
  let onFootSequence = playerBeforeMove.lastInputSequence ?? 0;
  for (let step = 0; step < 12; step++) {
    first.send(ON_FOOT_INPUT_MESSAGE, {
      moves: [{sequence: ++onFootSequence, x: 0, y: 1}]
    });
    await delay(35);
  }
  first.send(ON_FOOT_INPUT_MESSAGE, {
    moves: [{sequence: ++onFootSequence, x: 0, y: 0}]
  });
  await waitUntil(() => (
    first.state.players.get(first.sessionId)?.lastInputSequence === onFootSequence
  ));
  await waitUntil(() => Math.abs((first.state.players.get(first.sessionId)?.y ?? startY) - startY) > 8);
  await waitUntil(() => Math.abs(
    (second.state.players.get(first.sessionId)?.y ?? startY) -
    (first.state.players.get(first.sessionId)?.y ?? startY)
  ) < 3);

  let attackDistance = await moveNear(
    first,
    first.sessionId,
    second.sessionId,
    52,
    (mover, target) => (
      world.hasLineOfSight(mover.x, mover.y, target.x, target.y) &&
      hasVehicleClearance(first, mover, target)
    )
  );
  if (attackDistance > 40) {
    attackDistance = await moveNear(
      second,
      second.sessionId,
      first.sessionId,
      36,
      (mover, target) => (
        world.hasLineOfSight(mover.x, mover.y, target.x, target.y) &&
        hasVehicleClearance(second, mover, target)
      )
    );
  }
  assert.ok(attackDistance <= 44, `Players stopped ${Math.round(attackDistance)} units apart.`);
  const targetHealthBeforeMelee = first.state.players.get(second.sessionId)?.health ?? 100;
  const targetArmorBeforeMelee = first.state.players.get(second.sessionId)?.armor ?? 0;
  const targetReactionBeforeMelee = first.state.players.get(second.sessionId)?.reactionSequence ?? 0;
  const attackerBulletsBeforeMelee = [...first.state.bullets.values()]
    .filter((bullet) => bullet.ownerId === first.sessionId).length;
  const ammoBeforeMelee = {
    pistol: first.state.players.get(first.sessionId)?.ammoPistol,
    smg: first.state.players.get(first.sessionId)?.ammoSmg,
    shotgun: first.state.players.get(first.sessionId)?.ammoShotgun,
    grenade: first.state.players.get(first.sessionId)?.ammoGrenade
  };
  first.send('cycleWeapon', {direction: -1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'bat');
  const meleeAttacker = first.state.players.get(first.sessionId);
  const meleeTarget = first.state.players.get(second.sessionId);
  assert.ok(meleeAttacker && meleeTarget);
  first.send('aim', {angle: Math.atan2(
    meleeTarget.y - meleeAttacker.y,
    meleeTarget.x - meleeAttacker.x
  )});
  await delay(40);
  const sequenceBefore = meleeAttacker.attackSequence ?? 0;
  first.send('shoot');
  await waitUntil(() => (
    (first.state.players.get(first.sessionId)?.attackSequence ?? 0) > sequenceBefore &&
    (second.state.players.get(first.sessionId)?.attackSequence ?? 0) > sequenceBefore
  ));
  assert.equal(second.state.players.get(first.sessionId)?.action, 'melee');
  await delay(700);
  const meleeReactionReplicated = (
    (first.state.players.get(second.sessionId)?.reactionSequence ?? 0) >
      targetReactionBeforeMelee &&
    (second.state.players.get(second.sessionId)?.reactionSequence ?? 0) >
      targetReactionBeforeMelee
  );
  assert.ok(meleeReactionReplicated, JSON.stringify({
    attacker: first.state.players.get(first.sessionId),
    target: first.state.players.get(second.sessionId),
    remoteTarget: second.state.players.get(second.sessionId),
    vehicles: [...first.state.vehicles.values()].map((vehicle) => ({
      id: vehicle.id,
      x: vehicle.x,
      y: vehicle.y,
      destroyed: vehicle.destroyed
    }))
  }));
  const meleeDamageToHealth = Math.max(0, 34 - targetArmorBeforeMelee);
  assert.equal(first.state.players.get(second.sessionId)?.armor, 0);
  assert.equal(first.state.players.get(second.sessionId)?.health, targetHealthBeforeMelee - meleeDamageToHealth);
  assert.equal(first.state.players.get(second.sessionId)?.reactionKind, 'knockdown');
  assert.equal(second.state.players.get(second.sessionId)?.reactionKind, 'knockdown');
  assert.equal(first.state.players.get(second.sessionId)?.action, 'knockdown');
  assert.equal(
    [...first.state.bullets.values()].filter((bullet) => bullet.ownerId === first.sessionId).length,
    attackerBulletsBeforeMelee
  );
  assert.deepEqual(
    {
      pistol: first.state.players.get(first.sessionId)?.ammoPistol,
      smg: first.state.players.get(first.sessionId)?.ammoSmg,
      shotgun: first.state.players.get(first.sessionId)?.ammoShotgun,
      grenade: first.state.players.get(first.sessionId)?.ammoGrenade
    },
    ammoBeforeMelee
  );
  await waitUntil(() => first.state.players.get(first.sessionId)?.action === '');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'pistol');
  const killDeadline = Date.now() + 8_000;
  while (Date.now() < killDeadline && first.state.players.get(second.sessionId)?.alive) {
    const shooter = first.state.players.get(first.sessionId);
    const target = first.state.players.get(second.sessionId);
    assert.ok(shooter && target);
    assert.equal(shooter.alive, true, 'Police response killed the test shooter before the duel ended.');
    if (shooter.action) {
      await delay(50);
      continue;
    }
    first.send('aim', {angle: Math.atan2(target.y - shooter.y, target.x - shooter.x)});
    await delay(25);
    first.send('shoot');
    await delay(220);
  }
  assert.equal(
    first.state.players.get(second.sessionId)?.alive,
    false,
    'Authoritative pistol fire did not kill the target before the bounded duel deadline.'
  );
  await waitUntil(() => debugSnapshots.some((snapshot) => (
    snapshot.pursuits.length > 0 ||
    snapshot.policeResponse?.assignments.some((assignment) => (
      assignment.suspectId === first.sessionId
    ))
  )));
  assert.ok(debugSnapshots.some((snapshot) => (
    snapshot.events.some((event) => event.type === 'incident.reported')
  )));
  await waitUntil(() => debugSnapshots.some((snapshot) => snapshot.events.some((event) => (
    event.type === 'entity.killed' && event.summary.includes(second.sessionId)
  ))));
  const shooterAfterDuel = first.state.players.get(first.sessionId);
  if (shooterAfterDuel?.alive) {
    assert.ok(shooterAfterDuel.wanted >= 1);
    assert.ok(shooterAfterDuel.cash >= 100);
  } else {
    await waitUntil(() => first.state.players.get(first.sessionId)?.alive === true, 5000);
    await returnToStreetIfNeeded(first, first.sessionId);
  }
  await waitUntil(() => second.state.players.get(second.sessionId)?.alive === true, 5000);
  assert.equal(second.state.players.get(second.sessionId)?.health, 100);
  assert.equal(second.state.players.get(second.sessionId)?.armor, 0);
  await returnToStreetIfNeeded(second, second.sessionId);

  const hospital = INTERIORS[0];
  await driveToSpace(
    second,
    hospital.exteriorDoor.x,
    hospital.exteriorDoor.y,
    hospital.id
  );
  await waitUntil(() => (
    second.state.players.get(second.sessionId)?.spaceId === hospital.id &&
    second.state.npcs.size === 0 &&
    second.state.vehicles.size === 0 &&
    second.state.missions.size === 0 &&
    second.state.services.size === 1 &&
    second.state.services.has('hospital-mercy')
  ));
  await driveToSpace(
    second,
    hospital.exitDoor.maxX,
    (hospital.exitDoor.minY + hospital.exitDoor.maxY) / 2,
    STREET_SPACE_ID
  );
  await waitUntil(() => (
    second.state.npcs.size > 0 &&
    second.state.vehicles.size > 0 &&
    second.state.services.size === 1 &&
    second.state.services.has('repair-garage') &&
    !second.state.services.has('hospital-mercy')
  ));
  await waitUntil(() => first.state.players.get(first.sessionId)?.alive === true, 5000);
  await returnToStreetIfNeeded(first, first.sessionId);
  await waitUntil(() => (
    first.state.players.get(first.sessionId)?.spaceId === STREET_SPACE_ID &&
    first.state.npcs.size > 0
  ));

  await movePlayerTo(
    second,
    second.sessionId,
    second.state.missionContactX,
    second.state.missionContactY,
    75,
    world
  );
  await waitUntil(() => second.state.missions.size === 0, 6000);
  second.send(MISSION_START_MESSAGE, {templateId: 'crew-holdout'});
  await waitUntil(() => [...second.state.missions.values()].some((entry) => (
    entry.templateId === 'crew-holdout' && entry.phase === 'forming'
  )));
  const holdout = [...second.state.missions.values()].find((entry) => (
    entry.templateId === 'crew-holdout'
  ));
  assert.ok(holdout);
  await ensureLivingStreetPlayer(second, second.sessionId);
  const targetBeforeNpcApproach = second.state.players.get(second.sessionId);
  assert.ok(targetBeforeNpcApproach);
  const npcContactSurvivability = targetBeforeNpcApproach.health + (targetBeforeNpcApproach.armor ?? 0);
  const npcContactReaction = targetBeforeNpcApproach.reactionSequence ?? 0;
  second.send(MISSION_LAUNCH_MESSAGE, {missionId: holdout.id});
  await waitUntil(() => second.state.missions.get(holdout.id)?.phase === 'hold');
  await waitUntil(() => [...second.state.npcs.values()].some((npc) => npc.kind === 'hostile'));
  await waitUntil(() => {
    const player = second.state.players.get(second.sessionId);
    return Boolean(player && [...second.state.npcs.values()].some((npc) => (
      npc.kind === 'hostile' && npc.alive &&
      Math.hypot(npc.x - player.x, npc.y - player.y) < 170 &&
      world.hasLineOfSight(player.x, player.y, npc.x, npc.y)
    )));
  }, 8000);
  const hostile = [...second.state.npcs.values()]
    .filter((npc) => {
      const player = second.state.players.get(second.sessionId);
      return Boolean(player && npc.kind === 'hostile' && npc.alive &&
        world.hasLineOfSight(player.x, player.y, npc.x, npc.y));
    })
    .sort((left, right) => (
      Math.hypot(
        left.x - (second.state.players.get(second.sessionId)?.x ?? 0),
        left.y - (second.state.players.get(second.sessionId)?.y ?? 0)
      ) - Math.hypot(
        right.x - (second.state.players.get(second.sessionId)?.x ?? 0),
        right.y - (second.state.players.get(second.sessionId)?.y ?? 0)
      ) || left.id.localeCompare(right.id)
    ))[0];
  assert.ok(hostile);
  const hostileDistance = await movePlayerNearNpc(second, second.sessionId, hostile.id, 38);
  assert.ok(hostileDistance <= 50, `Player stopped ${Math.round(hostileDistance)} px from hostile.`);
  const playerAtHostile = second.state.players.get(second.sessionId);
  const hostileAtContact = second.state.npcs.get(hostile.id);
  assert.ok(playerAtHostile?.alive && hostileAtContact && world.hasLineOfSight(
    playerAtHostile.x,
    playerAtHostile.y,
    hostileAtContact.x,
    hostileAtContact.y
  ), 'Player and hostile must finish on the same visible side of collision geometry.');
  let meleeHostileId = '';
  await waitUntil(() => {
    const replicated = [...second.state.npcs.values()]
      .filter((npc) => npc.kind === 'hostile' && (npc.attackSequence ?? 0) > 0)
      .sort((left, right) => left.id.localeCompare(right.id))
      .find((npc) => (first.state.npcs.get(npc.id)?.attackSequence ?? 0) > 0);
    meleeHostileId = replicated?.id ?? '';
    return Boolean(replicated);
  }, 5000);
  await waitUntil(() => debugSnapshots.some((snapshot) => snapshot.events.some((event) => (
    event.type === 'npc.melee.started' && event.summary.includes(meleeHostileId)
  ))), 3000);
  await waitUntil(() => debugSnapshots.some((snapshot) => snapshot.events.some((event) => (
    event.type === 'damage.applied' &&
    event.summary.startsWith(`${meleeHostileId} -> player:${second.sessionId}`)
  ))), 3000);
  await waitUntil(() => {
    const target = second.state.players.get(second.sessionId);
    const remote = first.state.players.get(second.sessionId);
    return Boolean(
      target && remote &&
      target.health + (target.armor ?? 0) < npcContactSurvivability &&
      (target.reactionSequence ?? 0) > npcContactReaction &&
      (remote.reactionSequence ?? 0) > npcContactReaction
    );
  }, 3000);
  second.send(MISSION_ABANDON_MESSAGE, {missionId: holdout.id});
});

async function returnToStreetIfNeeded(
  room: Room<DistrictNetworkState>,
  playerId: string
): Promise<void> {
  const spaceId = room.state.players.get(playerId)?.spaceId || STREET_SPACE_ID;
  if (spaceId === STREET_SPACE_ID) return;
  const interior = INTERIORS.find((candidate) => candidate.id === spaceId);
  assert.ok(interior, `Unknown respawn interior: ${spaceId}`);
  await driveToSpace(
    room,
    interior.exitDoor.maxX,
    (interior.exitDoor.minY + interior.exitDoor.maxY) / 2,
    STREET_SPACE_ID
  );
}

async function waitForServer(port: number, child: ChildProcess, output: () => string): Promise<void> {
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`Game server stopped early.\n${output()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, 5000);
}

async function waitUntil(check: () => boolean | Promise<boolean>, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error('Timed out waiting for multiplayer state.');
}

async function moveNear(
  room: Room<DistrictNetworkState>,
  moverId: string,
  targetId: string,
  targetDistance: number,
  positionIsUsable: (
    mover: {x: number; y: number},
    target: {x: number; y: number}
  ) => boolean = () => true
): Promise<number> {
  let previousDistance = Number.POSITIVE_INFINITY;
  let stagnantSteps = 0;
  let detourSteps = 0;
  let detourDirection = 1;
  for (let step = 0; step < 60; step++) {
    const mover = room.state.players.get(moverId);
    const target = room.state.players.get(targetId);
    if (!mover || !target) {
      await delay(30);
      continue;
    }
    const deltaX = target.x - mover.x;
    const deltaY = target.y - mover.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= targetDistance && positionIsUsable(mover, target)) break;
    if (distance >= previousDistance - 1) stagnantSteps++;
    else stagnantSteps = 0;
    if (stagnantSteps >= 4) {
      detourSteps = 6;
      detourDirection *= -1;
      stagnantSteps = 0;
    }
    const input = detourSteps > 0
      ? {x: -deltaY / distance * detourDirection, y: deltaX / distance * detourDirection}
      : {x: deltaX / distance, y: deltaY / distance};
    if (detourSteps > 0) detourSteps--;
    room.send('input', input);
    previousDistance = distance;
    await delay(100);
  }
  room.send('input', {x: 0, y: 0});
  await delay(100);
  const mover = room.state.players.get(moverId);
  const target = room.state.players.get(targetId);
  return mover && target ? Math.hypot(target.x - mover.x, target.y - mover.y) : Number.POSITIVE_INFINITY;
}

async function movePlayerTo(
  room: Room<DistrictNetworkState>,
  playerId: string,
  x: number,
  y: number,
  targetDistance: number,
  world: CollisionMap
): Promise<void> {
  const planner = new PedestrianPathPlanner(world, 768, 48);
  let waypoints: Array<{x: number; y: number}> = [];
  let waypointIndex = 0;
  let previousDistance = Number.POSITIVE_INFINITY;
  let stagnantSteps = 0;
  let detourSteps = 0;
  let detourDirection = 1;
  const movementTrace: Array<{step: number; x: number; y: number; distance: number; detour: number}> = [];
  for (let step = 0; step < 180; step++) {
    const player = room.state.players.get(playerId);
    assert.ok(player?.alive, 'Moving player must remain alive.');
    const deltaX = x - player.x;
    const deltaY = y - player.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (step % 10 === 0 || detourSteps > 0) {
      movementTrace.push({step, x: player.x, y: player.y, distance, detour: detourSteps});
      if (movementTrace.length > 30) movementTrace.shift();
    }
    if (distance <= targetDistance) break;
    if (detourSteps > 0) stagnantSteps = 0;
    else if (distance >= previousDistance - 2) stagnantSteps++;
    else stagnantSteps = 0;
    if (stagnantSteps >= 4) {
      detourSteps = 8;
      detourDirection = chooseDetourDirection(world, player, {x, y}, detourDirection);
      waypoints = [];
      stagnantSteps = 0;
    }
    if (step > 0 && step % 12 === 0 && detourSteps === 0) waypoints = [];
    if (waypoints.length === 0 || waypointIndex >= waypoints.length) {
      const path = planMissionContactApproach(
        room,
        planner,
        world,
        player,
        {x, y},
        targetDistance
      );
      assert.ok(path, 'Expected a complete collision-safe route to the mission contact.');
      waypoints = path;
      waypointIndex = 0;
      stagnantSteps = 0;
    }
    while (
      waypointIndex < waypoints.length - 1 &&
      Math.hypot(waypoints[waypointIndex].x - player.x, waypoints[waypointIndex].y - player.y) <= 18
    ) waypointIndex++;
    const waypoint = waypoints[waypointIndex] ?? {x, y};
    const waypointX = waypoint.x - player.x;
    const waypointY = waypoint.y - player.y;
    const waypointDistance = Math.max(1, Math.hypot(waypointX, waypointY));
    const input = detourSteps > 0
      ? {
          x: -waypointY / waypointDistance * detourDirection,
          y: waypointX / waypointDistance * detourDirection
        }
      : {x: waypointX / waypointDistance, y: waypointY / waypointDistance};
    if (detourSteps > 0) {
      detourSteps--;
      if (detourSteps === 0) waypoints = [];
    }
    room.send('input', input);
    previousDistance = distance;
    await delay(50);
  }
  room.send('input', {x: 0, y: 0});
  await delay(100);
  const player = room.state.players.get(playerId);
  assert.ok(player?.alive, 'Moved player must remain alive.');
  const finalDistance = Math.hypot(x - player.x, y - player.y);
  const nearbyVehicles = [...room.state.vehicles.values()]
    .map((vehicle) => ({
      id: vehicle.id,
      x: vehicle.x,
      y: vehicle.y,
      angle: vehicle.angle,
      distance: Math.hypot(vehicle.x - player.x, vehicle.y - player.y)
    }))
    .filter((vehicle) => vehicle.distance < 120)
    .sort((left, right) => left.distance - right.distance);
  assert.ok(
    finalDistance <= targetDistance,
      `Moving player must reach the requested target radius (${finalDistance.toFixed(1)} > ${targetDistance}); ` +
      `player=${player.x.toFixed(1)},${player.y.toFixed(1)} target=${x.toFixed(1)},${y.toFixed(1)} ` +
      `nearbyVehicles=${JSON.stringify(nearbyVehicles)} trace=${JSON.stringify(movementTrace)}.`
  );
}

function chooseDetourDirection(
  world: CollisionMap,
  player: {x: number; y: number},
  target: {x: number; y: number},
  previousDirection: number
): number {
  const deltaX = target.x - player.x;
  const deltaY = target.y - player.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const perpendicular = {x: -deltaY / distance, y: deltaX / distance};
  const clearanceDistance = 72;
  const candidates = [previousDirection, -previousDirection];
  for (const direction of candidates) {
    if (world.canOccupy(
      player.x + perpendicular.x * clearanceDistance * direction,
      player.y + perpendicular.y * clearanceDistance * direction,
      11
    )) return direction;
  }
  return -previousDirection;
}

function planMissionContactApproach(
  room: Room<DistrictNetworkState>,
  planner: PedestrianPathPlanner,
  world: CollisionMap,
  player: {x: number; y: number},
  target: {x: number; y: number},
  targetDistance: number
): Array<{x: number; y: number}> | undefined {
  const approachRadius = Math.max(0, targetDistance - 20);
  const candidates = [
    target,
    ...Array.from({length: 16}, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return {
        x: target.x + Math.cos(angle) * approachRadius,
        y: target.y + Math.sin(angle) * approachRadius
      };
    })
  ];
  return candidates
    .map((candidate, index) => {
      if (!world.canOccupy(candidate.x, candidate.y, 11)) return undefined;
      const path = planner.plan(player, candidate, 11);
      if (
        !path?.complete ||
        !approachHasVehicleClearance(room, candidate)
      ) return undefined;
      return {
        index,
        distance: Math.hypot(candidate.x - player.x, candidate.y - player.y),
        vehicleConflicts: pathVehicleConflictCount(room, player, path.points),
        points: path.points
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => (
      left.vehicleConflicts - right.vehicleConflicts ||
      left.distance - right.distance ||
      left.index - right.index
    ))[0]
    ?.points;
}

function pathVehicleConflictCount(
  room: Room<DistrictNetworkState>,
  start: {x: number; y: number},
  points: ReadonlyArray<{x: number; y: number}>
): number {
  let conflicts = 0;
  let previous = start;
  for (const point of points) {
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const samples = Math.max(1, Math.ceil(distance / 14));
    for (let sample = 1; sample <= samples; sample++) {
      const progress = sample / samples;
      if (!approachHasVehicleClearance(room, {
        x: previous.x + (point.x - previous.x) * progress,
        y: previous.y + (point.y - previous.y) * progress
      })) conflicts++;
    }
    previous = point;
  }
  return conflicts;
}

function approachHasVehicleClearance(
  room: Room<DistrictNetworkState>,
  point: {x: number; y: number}
): boolean {
  return [...room.state.vehicles.values()].every((vehicle) => {
    const definition = vehicleConfig(vehicle.kind);
    return Math.hypot(vehicle.x - point.x, vehicle.y - point.y) >
      Math.hypot(definition.collision.length / 2, definition.collision.width / 2) + 11;
  });
}

function hasVehicleClearance(
  room: Room<DistrictNetworkState>,
  from: {x: number; y: number},
  to: {x: number; y: number}
): boolean {
  const segmentX = to.x - from.x;
  const segmentY = to.y - from.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared <= 0.0001) return true;
  return ![...room.state.vehicles.values()].some((vehicle) => {
    const progress = (
      (vehicle.x - from.x) * segmentX +
      (vehicle.y - from.y) * segmentY
    ) / lengthSquared;
    if (progress <= 0 || progress >= 1) return false;
    const closestX = from.x + segmentX * progress;
    const closestY = from.y + segmentY * progress;
    return Math.hypot(vehicle.x - closestX, vehicle.y - closestY) < 18;
  });
}

function safeFireAngle(
  room: Room<DistrictNetworkState>,
  shooterId: string,
  world: CollisionMap
): number {
  const shooter = room.state.players.get(shooterId);
  assert.ok(shooter, 'Safe firing requires a replicated shooter.');
  const ignoredVehicleId = shooter.vehicleId;
  let best = {angle: 0, wallDistance: Number.POSITIVE_INFINITY};
  for (let sample = 0; sample < 64; sample++) {
    const angle = sample / 64 * Math.PI * 2;
    let wallDistance = 900;
    for (let distance = 18; distance <= 900; distance += 12) {
      if (world.isBlockedAt(
        shooter.x + Math.cos(angle) * distance,
        shooter.y + Math.sin(angle) * distance
      )) {
        wallDistance = distance;
        break;
      }
    }
    const actors = [
      ...[...room.state.players.values()]
        .filter((player) => player.id !== shooterId && player.alive && !player.vehicleId)
        .map((player) => ({x: player.x, y: player.y, radius: 16})),
      ...[...room.state.npcs.values()]
        .filter((npc) => npc.alive)
        .map((npc) => ({x: npc.x, y: npc.y, radius: 15})),
      ...[...room.state.vehicles.values()]
        .filter((vehicle) => vehicle.id !== ignoredVehicleId && !vehicle.destroyed)
        .map((vehicle) => ({x: vehicle.x, y: vehicle.y, radius: 25}))
    ];
    const clear = actors.every((actor) => {
      const offsetX = actor.x - shooter.x;
      const offsetY = actor.y - shooter.y;
      const projection = offsetX * Math.cos(angle) + offsetY * Math.sin(angle);
      if (projection <= 0 || projection >= wallDistance) return true;
      const perpendicular = Math.abs(-offsetX * Math.sin(angle) + offsetY * Math.cos(angle));
      return perpendicular > actor.radius;
    });
    if (clear && wallDistance < best.wallDistance) best = {angle, wallDistance};
  }
  assert.ok(Number.isFinite(best.wallDistance), 'Expected one actor-safe firing lane into scenery.');
  return best.angle;
}

async function movePlayerNearNpc(
  room: Room<DistrictNetworkState>,
  playerId: string,
  npcId: string,
  targetDistance: number
): Promise<number> {
  const world = CollisionMap.load();
  const planner = new PedestrianPathPlanner(world, 768, 48);
  let waypoints: Array<{x: number; y: number}> = [];
  let waypointIndex = 0;
  let plannedTarget = {x: Number.NaN, y: Number.NaN};
  for (let step = 0; step < 160; step++) {
    let player = room.state.players.get(playerId);
    const npc = room.state.npcs.get(npcId);
    if (player && !player.alive && npc?.alive) {
      room.send('input', {x: 0, y: 0});
      await ensureLivingStreetPlayer(room, playerId);
      waypoints = [];
      waypointIndex = 0;
      plannedTarget = {x: Number.NaN, y: Number.NaN};
      player = room.state.players.get(playerId);
    }
    assert.ok(
      player?.alive && npc?.alive,
      `Melee participants must remain alive (player=${player?.alive}/${player?.health}, ` +
        `npc=${npc?.alive}/${npc?.health}).`
    );
    const deltaX = npc.x - player.x;
    const deltaY = npc.y - player.y;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    if (distance <= targetDistance && world.hasLineOfSight(player.x, player.y, npc.x, npc.y)) break;
    if (
      waypoints.length === 0 ||
      waypointIndex >= waypoints.length ||
      Math.hypot(npc.x - plannedTarget.x, npc.y - plannedTarget.y) > 28
    ) {
      const path = planner.plan(player, npc, 11);
      waypoints = path?.points ?? [{x: npc.x, y: npc.y}];
      waypointIndex = 0;
      plannedTarget = {x: npc.x, y: npc.y};
    }
    while (
      waypointIndex < waypoints.length - 1 &&
      Math.hypot(waypoints[waypointIndex].x - player.x, waypoints[waypointIndex].y - player.y) <= 18
    ) waypointIndex++;
    const waypoint = waypoints[waypointIndex] ?? npc;
    const waypointX = waypoint.x - player.x;
    const waypointY = waypoint.y - player.y;
    const waypointDistance = Math.max(1, Math.hypot(waypointX, waypointY));
    room.send('input', {x: waypointX / waypointDistance, y: waypointY / waypointDistance});
    await delay(50);
  }
  room.send('input', {x: 0, y: 0});
  const player = room.state.players.get(playerId);
  const npc = room.state.npcs.get(npcId);
  return player && npc ? Math.hypot(npc.x - player.x, npc.y - player.y) : Number.POSITIVE_INFINITY;
}

async function ensureLivingStreetPlayer(
  room: Room<DistrictNetworkState>,
  playerId: string
): Promise<void> {
  await waitUntil(() => room.state.players.get(playerId)?.alive === true, 8000);
  await returnToStreetIfNeeded(room, playerId);
  await waitUntil(() => (
    room.state.players.get(playerId)?.alive === true &&
    room.state.players.get(playerId)?.spaceId === STREET_SPACE_ID
  ), 5000);
}

async function driveToSpace(
  room: Room<DistrictNetworkState>,
  x: number,
  y: number,
  spaceId: string
): Promise<void> {
  for (let step = 0; step < 180; step++) {
    const player = room.state.players.get(room.sessionId);
    assert.ok(player, 'Local player must remain replicated during a space transition.');
    if ((player.spaceId || STREET_SPACE_ID) === spaceId) {
      room.send('input', {x: 0, y: 0});
      return;
    }
    const deltaX = x - player.x;
    const deltaY = y - player.y;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    room.send('input', {x: deltaX / distance, y: deltaY / distance});
    await delay(40);
  }
  room.send('input', {x: 0, y: 0});
  throw new Error(`Timed out driving client into space: ${spaceId}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function stopServer(server: ChildProcess): void {
  if (server.exitCode === null) server.kill('SIGTERM');
}

import {PedestrianController} from '../../server/game/pedestrians/pedestrian-controller.ts';
import {DeterministicRandom} from '../../server/game/world/deterministic-random.ts';
import {WorldStimulusRegistry} from '../../server/game/world/world-stimulus-registry.ts';

export function attachTestPedestrianController(room: any): PedestrianController {
  const controller = new PedestrianController({
    state: room.state,
    world: room.world,
    random: room.random ?? new DeterministicRandom('test-pedestrians'),
    stimuli: room.worldStimuli ?? new WorldStimulusRegistry(),
    clock: () => ({tick: room.simulationClock?.tick ?? 0}),
    policeTarget: (officer, nowMs) => room.crimeController?.policeTarget(officer, nowMs),
    requestPoliceFire: (officerId, x, y, angle, nowMs) => {
      room.fireControl?.createNpcBullet(officerId, x, y, angle, nowMs, 'pistol');
    },
    onSpawned: (npc) => room.indexNpc?.(npc)
  });
  room.pedestrians = controller;
  return controller;
}

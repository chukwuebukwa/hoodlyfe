import {TrafficController} from '../../server/game/traffic/traffic-controller.ts';
import {DeterministicRandom} from '../../server/game/world/deterministic-random.ts';

export function attachTestTrafficController(room: any): TrafficController {
  const controller = new TrafficController({
    world: room.world,
    random: room.random ?? new DeterministicRandom('test-traffic')
  });
  room.trafficController = controller;
  return controller;
}

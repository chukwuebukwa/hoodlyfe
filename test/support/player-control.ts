import {PlayerControlController} from '../../server/game/players/player-control-controller.ts';

export function attachTestPlayerControl(room: any): PlayerControlController {
  const controller = new PlayerControlController({
    state: room.state,
    world: room.world
  });
  room.playerControl = controller;
  return controller;
}

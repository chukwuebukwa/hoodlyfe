import type {PedestrianObjective} from './pedestrian-runtime.ts';

export interface PedestrianIntent {
  objective: PedestrianObjective;
  angle: number;
  speed: number;
  fire: boolean;
  aimAngle: number;
}

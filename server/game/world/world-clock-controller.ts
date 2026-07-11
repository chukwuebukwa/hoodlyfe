import {WORLD_CLOCK} from '../../../shared/content/world-time.ts';
import type {DistrictState} from '../../state.ts';

interface WorldClockControllerOptions {
  state: DistrictState;
  now: () => number;
}

export class WorldClockController {
  constructor(private readonly options: WorldClockControllerOptions) {}

  initialize(): void {
    if (this.options.state.worldTimeStartedAt > 0) return;
    this.options.state.worldTimeStartedAt = this.options.now();
    this.options.state.worldTimeStartMinute = WORLD_CLOCK.startMinute;
    this.options.state.worldTimeRate = WORLD_CLOCK.gameMinutesPerRealSecond;
  }
}

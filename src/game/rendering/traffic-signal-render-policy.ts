import type {TrafficSignalPhase} from '../../../shared/content/traffic-signals.ts';

export interface SignalLampPresentation {
  red: {color: number; alpha: number};
  yellow: {color: number; alpha: number};
  green: {color: number; alpha: number};
}

export function signalLampPresentation(phase: TrafficSignalPhase): SignalLampPresentation {
  return {
    red: {color: 0xff394f, alpha: phase === 'red' ? 1 : 0.18},
    yellow: {color: 0xffcc3d, alpha: phase === 'yellow' ? 1 : 0.16},
    green: {color: 0x55e889, alpha: phase === 'green' ? 1 : 0.16}
  };
}

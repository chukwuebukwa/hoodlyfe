import type {VehicleKind} from '../../../shared/content/vehicle-catalog.ts';
import {WORLD_CLOCK} from '../../../shared/content/world-time.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import {
  pedestrianKindForProfile,
  populationDayWeightAtMinute,
  populationDensityAdmits,
  populationProfileAt,
  vehicleKindForProfile
} from './population-zone-profile-policy.ts';

interface PopulationZoneProfileControllerOptions {
  random: Pick<DeterministicRandom, 'unit'>;
  worldMinute?: () => number;
}

interface PopulationActorPosition {
  x: number;
  y: number;
}

export interface PopulationZoneProfileDiagnostic {
  worldMinute: number;
  populationDayWeight: number;
  zoneActivity: string;
}

export class PopulationZoneProfileController {
  private currentMinute = WORLD_CLOCK.startMinute;

  constructor(private readonly options: PopulationZoneProfileControllerOptions) {}

  get enabled(): boolean {
    return Boolean(this.options.worldMinute);
  }

  update(): void {
    this.currentMinute = normalizeMinute(
      this.options.worldMinute?.() ?? WORLD_CLOCK.startMinute
    );
  }

  pedestrianAdmits(id: string, x: number, y: number): boolean {
    if (!this.enabled) return true;
    const profile = populationProfileAt(x, y, this.currentMinute);
    return populationDensityAdmits(
      profile.pedestrianDensity,
      this.options.random.unit('stream-ped-density', `${id}:${profile.zone.id}`)
    );
  }

  trafficAdmits(id: string, x: number, y: number): boolean {
    if (!this.enabled) return true;
    const profile = populationProfileAt(x, y, this.currentMinute);
    return populationDensityAdmits(
      profile.trafficDensity,
      this.options.random.unit('stream-traffic-density', `${id}:${profile.zone.id}`)
    );
  }

  pedestrianKind(id: string, x: number, y: number): 'civilian' | 'police' {
    const profile = populationProfileAt(x, y, this.currentMinute);
    return pedestrianKindForProfile(
      profile,
      this.options.random.unit('stream-ped-kind', `${id}:${profile.zone.id}`)
    );
  }

  trafficKind(id: string, x: number, y: number): VehicleKind {
    const profile = populationProfileAt(x, y, this.currentMinute);
    return vehicleKindForProfile(
      profile,
      this.options.random.unit('stream-traffic-kind', `${id}:${profile.zone.id}`)
    );
  }

  diagnostics(activeActors: readonly PopulationActorPosition[]): PopulationZoneProfileDiagnostic {
    const counts = new Map<string, number>();
    for (const actor of activeActors) {
      const zoneId = populationProfileAt(actor.x, actor.y, this.currentMinute).zone.id;
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1);
    }
    return {
      worldMinute: this.currentMinute,
      populationDayWeight: populationDayWeightAtMinute(this.currentMinute),
      zoneActivity: [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([zoneId, count]) => `${zoneId}:${count}`)
        .join(',') || 'none'
    };
  }
}

function normalizeMinute(value: number): number {
  const minute = Number.isFinite(value) ? value : WORLD_CLOCK.startMinute;
  return ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
}

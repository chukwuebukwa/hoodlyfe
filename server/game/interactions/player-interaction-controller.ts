interface ServiceInteractionPort {
  interact(playerId: string, nowMs: number): boolean;
}

interface VehicleInteractionPort {
  interact(playerId: string, nowMs: number): void;
}

interface PlayerInteractionControllerOptions {
  services: ServiceInteractionPort;
  vehicles: VehicleInteractionPort;
}

export type PlayerInteractionResult = 'service' | 'vehicle' | 'duplicate';

export class PlayerInteractionController {
  private readonly lastTick = new Map<string, number>();

  constructor(private readonly options: PlayerInteractionControllerOptions) {}

  interact(playerId: string, nowMs: number, tick: number): PlayerInteractionResult {
    if (this.lastTick.get(playerId) === tick) return 'duplicate';
    this.lastTick.set(playerId, tick);
    if (this.options.services.interact(playerId, nowMs)) return 'service';
    this.options.vehicles.interact(playerId, nowMs);
    return 'vehicle';
  }

  clearPlayer(playerId: string): void {
    this.lastTick.delete(playerId);
  }
}

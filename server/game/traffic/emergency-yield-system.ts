import type {VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

export interface EmergencyVehicleSnapshot {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  siren: boolean;
  destroyed: boolean;
}

export type EmergencyYieldPhase = 'none' | 'yield-left' | 'yield-right' | 'wait';

export interface EmergencyYieldRuntime {
  phase: EmergencyYieldPhase;
  emergencyId: string;
  until: number;
  targetX: number;
  targetY: number;
}

export interface EmergencyYieldCommand {
  phase: EmergencyYieldPhase;
  emergencyId: string;
  targetX?: number;
  targetY?: number;
  maximumSpeed?: number;
}

const MINIMUM_SIREN_SPEED = 20;
const YIELD_DURATION_MS = 1800;
const YIELD_LATERAL_DISTANCE = 42;
const YIELD_FORWARD_DISTANCE = 84;

export class EmergencyYieldSystem {
  constructor(private readonly world: CollisionMap) {}

  createRuntime(): EmergencyYieldRuntime {
    return {phase: 'none', emergencyId: '', until: 0, targetX: 0, targetY: 0};
  }

  command(
    vehicle: VehicleState,
    runtime: EmergencyYieldRuntime,
    emergencies: readonly EmergencyVehicleSnapshot[],
    nowMs: number
  ): EmergencyYieldCommand {
    if (runtime.phase !== 'none' && nowMs < runtime.until) {
      return this.runtimeCommand(runtime);
    }
    this.reset(runtime);
    const emergency = this.selectEmergency(vehicle, emergencies);
    if (!emergency) return {phase: 'none', emergencyId: ''};

    const alignment = Math.cos(vehicle.angle - emergency.angle);
    if (alignment <= 0.7) {
      Object.assign(runtime, {
        phase: 'wait' as const,
        emergencyId: emergency.id,
        until: nowMs + YIELD_DURATION_MS
      });
      return this.runtimeCommand(runtime);
    }

    const rightX = -Math.sin(vehicle.angle);
    const rightY = Math.cos(vehicle.angle);
    const emergencyRightX = -Math.sin(emergency.angle);
    const emergencyRightY = Math.cos(emergency.angle);
    const lateral = (vehicle.x - emergency.x) * emergencyRightX +
      (vehicle.y - emergency.y) * emergencyRightY;
    const preferredSide = lateral < -4 ? -1 : 1;
    const side = this.openSide(vehicle, rightX, rightY, preferredSide);
    if (side === 0) {
      Object.assign(runtime, {
        phase: 'wait' as const,
        emergencyId: emergency.id,
        until: nowMs + YIELD_DURATION_MS
      });
      return this.runtimeCommand(runtime);
    }
    const forwardX = Math.cos(vehicle.angle);
    const forwardY = Math.sin(vehicle.angle);
    Object.assign(runtime, {
      phase: side < 0 ? 'yield-left' as const : 'yield-right' as const,
      emergencyId: emergency.id,
      until: nowMs + YIELD_DURATION_MS,
      targetX: vehicle.x + forwardX * YIELD_FORWARD_DISTANCE + rightX * YIELD_LATERAL_DISTANCE * side,
      targetY: vehicle.y + forwardY * YIELD_FORWARD_DISTANCE + rightY * YIELD_LATERAL_DISTANCE * side
    });
    return this.runtimeCommand(runtime);
  }

  reset(runtime: EmergencyYieldRuntime): void {
    runtime.phase = 'none';
    runtime.emergencyId = '';
    runtime.until = 0;
    runtime.targetX = 0;
    runtime.targetY = 0;
  }

  private selectEmergency(
    vehicle: VehicleState,
    emergencies: readonly EmergencyVehicleSnapshot[]
  ): EmergencyVehicleSnapshot | undefined {
    return [...emergencies]
      .filter((emergency) => {
        if (!emergency.siren || emergency.destroyed || emergency.id === vehicle.id) return false;
        const speed = Math.abs(emergency.speed);
        if (speed < MINIMUM_SIREN_SPEED) return false;
        const deltaX = vehicle.x - emergency.x;
        const deltaY = vehicle.y - emergency.y;
        const forwardX = Math.cos(emergency.angle);
        const forwardY = Math.sin(emergency.angle);
        const forwardDistance = deltaX * forwardX + deltaY * forwardY;
        const lateralDistance = Math.abs(-deltaX * forwardY + deltaY * forwardX);
        const projection = Math.max(180, Math.min(340, 90 + speed * 1.35));
        return forwardDistance > 0 && forwardDistance <= projection && lateralDistance <= 92;
      })
      .sort((left, right) => (
        Math.hypot(left.x - vehicle.x, left.y - vehicle.y) -
        Math.hypot(right.x - vehicle.x, right.y - vehicle.y)
      ) || left.id.localeCompare(right.id))[0];
  }

  private openSide(vehicle: VehicleState, rightX: number, rightY: number, preferred: number): number {
    for (const side of [preferred, -preferred]) {
      const x = vehicle.x + Math.cos(vehicle.angle) * YIELD_FORWARD_DISTANCE +
        rightX * YIELD_LATERAL_DISTANCE * side;
      const y = vehicle.y + Math.sin(vehicle.angle) * YIELD_FORWARD_DISTANCE +
        rightY * YIELD_LATERAL_DISTANCE * side;
      if (this.world.canOccupy(x, y, 20) && this.world.isRoadAt(x, y)) return side;
    }
    return 0;
  }

  private runtimeCommand(runtime: EmergencyYieldRuntime): EmergencyYieldCommand {
    return {
      phase: runtime.phase,
      emergencyId: runtime.emergencyId,
      targetX: runtime.phase.startsWith('yield-') ? runtime.targetX : undefined,
      targetY: runtime.phase.startsWith('yield-') ? runtime.targetY : undefined,
      maximumSpeed: runtime.phase === 'wait' ? 0 : 72
    };
  }
}

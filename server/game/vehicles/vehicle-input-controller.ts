import type {DistrictState} from '../../state.ts';
import type {
  VehicleInputBatchMessage,
  VehicleInputMoveMessage
} from '../../../shared/protocol/vehicle-input.ts';

export interface AppliedVehicleInput {
  inputX: number;
  inputY: number;
  sequence: number;
  handbrake?: boolean;
}

interface VehicleInputQueue {
  vehicleId: string;
  receivedSequence: number;
  appliedSequence: number;
  held: AppliedVehicleInput;
  pending: AppliedVehicleInput[];
}

const MAX_BATCH_MOVES = 4;
const MAX_PENDING_MOVES = 12;
const MAX_SEQUENCE_ADVANCE = 4_096;

export class VehicleInputController {
  private readonly queues = new Map<string, VehicleInputQueue>();

  constructor(private readonly state: DistrictState) {}

  accept(playerId: string, message?: VehicleInputBatchMessage): number {
    const player = this.state.players.get(playerId);
    const vehicleId = typeof message?.vehicleId === 'string' ? message.vehicleId : '';
    if (!player?.alive || !vehicleId || player.vehicleId !== vehicleId || player.vehicleSeat !== 0) return 0;
    const vehicle = this.state.vehicles.get(vehicleId);
    if (!vehicle || vehicle.driverId !== playerId || vehicle.destroyed) return 0;
    const moves = Array.isArray(message?.moves) ? message.moves.slice(0, MAX_BATCH_MOVES) : [];
    let queue = this.queues.get(playerId);
    if (!queue || queue.vehicleId !== vehicleId) {
      queue = {
        vehicleId,
        receivedSequence: player.lastVehicleInputSequence,
        appliedSequence: player.lastVehicleInputSequence,
        held: {inputX: 0, inputY: 0, sequence: player.lastVehicleInputSequence},
        pending: []
      };
      this.queues.set(playerId, queue);
    }
    let accepted = 0;
    for (const move of moves) {
      const parsed = parseMove(move, queue.receivedSequence);
      if (!parsed) continue;
      queue.pending.push(parsed);
      queue.receivedSequence = parsed.sequence;
      accepted += 1;
    }
    if (queue.pending.length > MAX_PENDING_MOVES) {
      queue.pending.splice(0, queue.pending.length - MAX_PENDING_MOVES);
    }
    return accepted;
  }

  consume(playerId: string, vehicleId: string): AppliedVehicleInput | undefined {
    const queue = this.queues.get(playerId);
    if (!queue || queue.vehicleId !== vehicleId) return undefined;
    const next = queue.pending.shift();
    if (next) queue.held = next;
    return queue.held;
  }

  inputFor(playerId: string, vehicleId: string): AppliedVehicleInput | undefined {
    const queue = this.queues.get(playerId);
    if (!queue || queue.vehicleId !== vehicleId) return undefined;
    return {...queue.held};
  }

  acknowledge(playerId: string, vehicleId: string, sequence: number): void {
    const queue = this.queues.get(playerId);
    const player = this.state.players.get(playerId);
    if (!queue || queue.vehicleId !== vehicleId || !player || sequence < queue.appliedSequence) return;
    queue.appliedSequence = sequence;
    player.lastVehicleInputSequence = sequence;
  }

  clear(playerId: string): void {
    this.queues.delete(playerId);
  }
}

function parseMove(
  move: VehicleInputMoveMessage,
  previousSequence: number
): AppliedVehicleInput | undefined {
  const sequence = Number(move?.sequence);
  if (
    !Number.isSafeInteger(sequence) || sequence <= previousSequence ||
    sequence - previousSequence > MAX_SEQUENCE_ADVANCE
  ) return undefined;
  const x = Number(move?.x);
  const y = Number(move?.y);
  return {
    inputX: Number.isFinite(x) ? clamp(x, -1, 1) : 0,
    inputY: Number.isFinite(y) ? clamp(y, -1, 1) : 0,
    sequence,
    ...(move?.handbrake === true ? {handbrake: true} : {})
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

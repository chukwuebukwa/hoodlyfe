import type {NetworkPlayer, NetworkVehicle} from '../types.ts';
import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  characterClipFrame,
  characterClipProgressFrame
} from '../../../shared/content/character-animation-manifest.ts';

export const ACTION_SPRITE_COLUMNS = 4;
export const ACTION_SPRITE_ROWS = 3;
export const VEHICLE_DOOR_COLUMNS = 5;
export const VEHICLE_DOOR_ROWS = 3;

export type CharacterActionSprite = 'walk' | 'melee' | 'dead' | 'vehicle';

export interface CharacterActionPresentation {
  sprite: CharacterActionSprite;
  frame: number;
}

export interface VehicleDoorPresentation {
  frame: number;
  open: boolean;
}

export function playerActionSprite(
  player: NetworkPlayer,
  nowMs = Date.now(),
  localActionStartedAt?: number
): CharacterActionPresentation {
  if (!player.alive) return {sprite: 'dead', frame: characterClipProgressFrame('dead', 0)};
  if (player.action === 'melee') {
    return {sprite: 'melee', frame: characterClipProgressFrame('melee', player.attackProgress ?? 0)};
  }
  if (player.action === 'entering' || player.action === 'hijacking') {
    const duration = player.action === 'hijacking' ? 1050 : 320;
    const progress = localActionStartedAt === undefined
      ? 1 - Math.max(0, player.actionUntil - nowMs) / duration
      : (nowMs - localActionStartedAt) / duration;
    return {sprite: 'vehicle', frame: characterClipProgressFrame('vehicleEnter', progress)};
  }
  return {sprite: 'walk', frame: 0};
}

export function npcActionSprite(
  alive: boolean,
  action: string,
  attackProgress = 0
): CharacterActionPresentation {
  if (!alive || action === 'dead') {
    return {sprite: 'dead', frame: characterClipProgressFrame('dead', 0)};
  }
  if (action === 'melee') {
    return {sprite: 'melee', frame: characterClipProgressFrame('melee', attackProgress)};
  }
  return {sprite: 'walk', frame: 0};
}

export function ejectedDriverActionSprite(
  localAnimationStartedAt: number | undefined,
  nowMs = Date.now()
): CharacterActionPresentation | undefined {
  if (localAnimationStartedAt === undefined) return undefined;
  const elapsed = nowMs - localAnimationStartedAt;
  if (elapsed < 0 || elapsed >= 1100) return undefined;
  return {sprite: 'vehicle', frame: characterClipFrame('ejected', elapsed)};
}

export function vehicleDoorPresentation(
  vehicle: NetworkVehicle,
  players: Iterable<NetworkPlayer>
): VehicleDoorPresentation {
  const playerList = [...players];
  const actionPlayer = playerList.find((player) =>
    player.alive &&
    player.actionVehicleId === vehicle.id &&
    (player.action === 'entering' || player.action === 'hijacking')
  );
  if (!actionPlayer) return {frame: 0, open: false};

  const definition = vehicleDefinition(vehicle.kind);
  const occupants = playerList
    .filter((player) => player.vehicleId === vehicle.id && player.alive)
    .map((player) => player.vehicleSeat);
  const targetSeat = nextSeat(vehicle.driverId !== '', occupants, definition.seats);
  const rear = definition.seats > 2 && targetSeat >= 2;

  const sideAngle = vehicle.angle + Math.PI / 2;
  const sideDot = (actionPlayer.x - vehicle.x) * Math.cos(sideAngle) +
    (actionPlayer.y - vehicle.y) * Math.sin(sideAngle);
  // Server Y is inverted for the Three.js presentation, so atlas left/right is mirrored here.
  const left = sideDot < 0;
  if (rear) return {frame: left ? 3 : 4, open: true};
  return {frame: left ? 1 : 2, open: true};
}

export function vehicleDoorAtlasFrame(vehicle: NetworkVehicle, doorFrame: number): number {
  return vehicleDefinition(vehicle.kind).presentation.frame * VEHICLE_DOOR_COLUMNS + doorFrame;
}

function nextSeat(driverOccupied: boolean, occupied: number[], seats: number): number {
  const occupiedSeats = new Set(occupied);
  let seat = driverOccupied ? 1 : 0;
  while (seat < seats && occupiedSeats.has(seat)) seat++;
  return Math.min(seat, Math.max(0, seats - 1));
}

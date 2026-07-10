export type MinimapMarkerKind =
  | 'local-player'
  | 'remote-player'
  | 'police'
  | 'objective'
  | 'contact'
  | 'shop'
  | 'property';

export interface MinimapPlayerInput {
  id: string;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  wanted: number;
  vehicleId: string;
}

export interface MinimapVehicleInput {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  destroyed: boolean;
}

export interface MinimapNpcInput {
  id: string;
  kind: 'civilian' | 'police';
  x: number;
  y: number;
  angle: number;
  alive: boolean;
}

export interface MinimapPointInput {
  id: string;
  kind: 'objective' | 'contact' | 'shop' | 'property';
  x: number;
  y: number;
  angle?: number;
}

export interface MinimapMarker {
  id: string;
  kind: MinimapMarkerKind;
  x: number;
  y: number;
  angle: number;
  distance: number;
  clamped: boolean;
  priority: number;
}

export interface MinimapFrame {
  originX: number;
  originY: number;
  heading: number;
  range: number;
  wantedLevel: number;
  markers: MinimapMarker[];
}

export interface MinimapPolicyInput {
  localPlayerId: string;
  players: Iterable<MinimapPlayerInput>;
  vehicles: Iterable<MinimapVehicleInput>;
  npcs: Iterable<MinimapNpcInput>;
  points?: Iterable<MinimapPointInput>;
}

const ON_FOOT_RANGE = 520;
const MIN_DRIVING_RANGE = 620;
const MAX_DRIVING_RANGE = 1100;
const RANGE_SPEED = 410;

export function buildMinimapFrame(input: MinimapPolicyInput): MinimapFrame | undefined {
  const players = [...input.players];
  const vehicles = new Map([...input.vehicles].map((vehicle) => [vehicle.id, vehicle]));
  const local = players.find((player) => player.id === input.localPlayerId);
  if (!local) return undefined;
  const localVehicle = local.vehicleId ? vehicles.get(local.vehicleId) : undefined;
  const localPosition = effectivePosition(local, localVehicle);
  const range = localVehicle && !localVehicle.destroyed
    ? drivingRange(localVehicle.speed)
    : ON_FOOT_RANGE;
  const markers: MinimapMarker[] = [];

  markers.push(markerFor(
    `local:${local.id}`,
    'local-player',
    localPosition.x,
    localPosition.y,
    localPosition.angle,
    localPosition.x,
    localPosition.y,
    range,
    100
  ));

  for (const player of players) {
    if (player.id === local.id || !player.alive) continue;
    const vehicle = player.vehicleId ? vehicles.get(player.vehicleId) : undefined;
    const position = effectivePosition(player, vehicle);
    markers.push(markerFor(
      `player:${player.id}`,
      'remote-player',
      position.x,
      position.y,
      position.angle,
      localPosition.x,
      localPosition.y,
      range,
      70
    ));
  }

  if (local.wanted > 0) {
    for (const npc of input.npcs) {
      if (!npc.alive || npc.kind !== 'police') continue;
      const distance = Math.hypot(npc.x - localPosition.x, npc.y - localPosition.y);
      if (distance > range * 1.7) continue;
      markers.push(markerFor(
        `police:${npc.id}`,
        'police',
        npc.x,
        npc.y,
        npc.angle,
        localPosition.x,
        localPosition.y,
        range,
        55
      ));
    }
  }

  for (const point of input.points ?? []) {
    const distance = Math.hypot(point.x - localPosition.x, point.y - localPosition.y);
    if (point.kind !== 'objective' && distance > range * 1.25) continue;
    markers.push(markerFor(
      `${point.kind}:${point.id}`,
      point.kind,
      point.x,
      point.y,
      point.angle ?? 0,
      localPosition.x,
      localPosition.y,
      range,
      point.kind === 'objective' ? 90 : 40
    ));
  }

  markers.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  return {
    originX: localPosition.x,
    originY: localPosition.y,
    heading: localPosition.angle,
    range,
    wantedLevel: local.wanted,
    markers
  };
}

export function drivingRange(speed: number): number {
  const ratio = Math.max(0, Math.min(1, Math.abs(speed) / RANGE_SPEED));
  return MIN_DRIVING_RANGE + (MAX_DRIVING_RANGE - MIN_DRIVING_RANGE) * ratio;
}

function effectivePosition(
  player: MinimapPlayerInput,
  vehicle: MinimapVehicleInput | undefined
): {x: number; y: number; angle: number} {
  if (vehicle && !vehicle.destroyed) {
    return {x: vehicle.x, y: vehicle.y, angle: vehicle.angle};
  }
  return {x: player.x, y: player.y, angle: player.angle};
}

function markerFor(
  id: string,
  kind: MinimapMarkerKind,
  x: number,
  y: number,
  angle: number,
  originX: number,
  originY: number,
  range: number,
  priority: number
): MinimapMarker {
  const distance = Math.hypot(x - originX, y - originY);
  return {id, kind, x, y, angle, distance, clamped: distance > range, priority};
}

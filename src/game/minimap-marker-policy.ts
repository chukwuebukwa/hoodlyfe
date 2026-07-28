export type MinimapMarkerKind =
  | 'local-player'
  | 'remote-player'
  | 'police'
  | 'hostile'
  | 'objective'
  | 'contact'
  | 'shop'
  | 'ammunition'
  | 'clothing'
  | 'hospital'
  | 'repair'
  | 'pickup'
  | 'cash'
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
  linvelX?: number;
  linvelY?: number;
  destroyed: boolean;
}

export interface MinimapNpcInput {
  id: string;
  kind: 'civilian' | 'police' | 'hostile';
  x: number;
  y: number;
  angle: number;
  alive: boolean;
}

export interface MinimapPointInput {
  id: string;
  kind: 'objective' | 'contact' | 'shop' | 'ammunition' | 'clothing' | 'hospital' | 'repair' |
    'pickup' | 'cash' | 'property' | 'hostile';
  x: number;
  y: number;
  angle?: number;
  label?: string;
  color?: number;
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
  label?: string;
  color?: number;
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
  localPose?: {x: number; y: number; angle: number};
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
  const localPosition = input.localPose ?? effectivePosition(local, localVehicle);
  const range = localVehicle && !localVehicle.destroyed
    ? drivingRange(vehicleMotionSpeed(localVehicle))
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
    if (point.kind !== 'objective' && !isPermanentLocation(point.kind) && distance > range * 1.25) continue;
    const marker = markerFor(
      `${point.kind}:${point.id}`,
      point.kind,
      point.x,
      point.y,
      point.angle ?? 0,
      localPosition.x,
      localPosition.y,
      range,
      point.kind === 'objective' ? 90 : (point.kind === 'hostile' ? 65 :
        (point.kind === 'pickup' || point.kind === 'cash' ? 45 : 40))
    );
    if (point.label) marker.label = point.label;
    if (point.color !== undefined) marker.color = point.color;
    markers.push(marker);
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

function isPermanentLocation(kind: MinimapPointInput['kind']): boolean {
  return kind === 'contact' || kind === 'ammunition' || kind === 'clothing' ||
    kind === 'hospital' || kind === 'repair';
}

export function drivingRange(speed: number): number {
  const ratio = Math.max(0, Math.min(1, Math.abs(speed) / RANGE_SPEED));
  return MIN_DRIVING_RANGE + (MAX_DRIVING_RANGE - MIN_DRIVING_RANGE) * ratio;
}

function vehicleMotionSpeed(vehicle: MinimapVehicleInput): number {
  return Number.isFinite(vehicle.linvelX) && Number.isFinite(vehicle.linvelY)
    ? Math.hypot(vehicle.linvelX!, vehicle.linvelY!)
    : Math.abs(vehicle.speed);
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

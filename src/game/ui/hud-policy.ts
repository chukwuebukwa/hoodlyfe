import type {GameNotice} from '../../../shared/protocol/notices.ts';
import type {NetworkPlayer, NetworkVehicle} from '../types.ts';

export interface LocalHudProjection {
  name: string;
  cash: string;
  health: number;
  wanted: number;
  dead: boolean;
  showVehicleHud: boolean;
  showWeaponHud: boolean;
  weaponName: string;
  weaponAmmo: number;
  weaponIcon: string;
  speed: string;
  vehicleCondition: number;
  vehicleHealth: number;
  mode: 'foot' | 'vehicle' | 'dead';
  action: NetworkPlayer['action'];
}

export interface HudTransitionState {
  wanted: number;
  cash: number;
  action: NetworkPlayer['action'];
}

export interface HudNotice {
  message: string;
  tone: GameNotice['tone'];
}

export function projectLocalHud(
  player: NetworkPlayer,
  vehicle?: NetworkVehicle
): LocalHudProjection {
  const isDriver = Boolean(player.vehicleId) && player.vehicleSeat === 0;
  return {
    name: player.name,
    cash: `$${String(Math.max(0, finite(player.cash))).padStart(6, '0')}`,
    health: clamp(finite(player.health), 0, 100),
    wanted: clamp(Math.floor(finite(player.wanted)), 0, 5),
    dead: !player.alive,
    showVehicleHud: isDriver,
    showWeaponHud: !isDriver && player.alive && !player.action,
    weaponName: player.weapon === 'smg' ? 'SMG' : player.weapon.toUpperCase(),
    weaponAmmo: weaponAmmo(player),
    weaponIcon: `/assets/original/weapons/${player.weapon}.svg`,
    speed: String(Math.round(Math.abs(finite(vehicle?.speed)) * 0.55)).padStart(3, '0'),
    vehicleCondition: clamp(
      finite(vehicle?.health) / Math.max(1, finite(vehicle?.maxHealth, 1)) * 100,
      0,
      100
    ),
    vehicleHealth: Math.max(0, finite(vehicle?.health)),
    mode: player.alive ? (player.vehicleId ? 'vehicle' : 'foot') : 'dead',
    action: player.action
  };
}

export function hudTransitionState(player: NetworkPlayer): HudTransitionState {
  return {wanted: player.wanted, cash: player.cash, action: player.action};
}

export function hudTransitionNotices(
  previous: HudTransitionState | undefined,
  current: HudTransitionState
): HudNotice[] {
  if (!previous) return [];
  const notices: HudNotice[] = [];
  if (current.wanted > previous.wanted) {
    notices.push({
      message: current.wanted >= 3 ? 'POLICE ESCALATION' : 'WANTED',
      tone: 'warning'
    });
  }
  if (current.wanted === 0 && previous.wanted > 0) {
    notices.push({message: 'HEAT LOST', tone: 'success'});
  }
  if (current.cash > previous.cash) {
    notices.push({message: `+$${current.cash - previous.cash}`, tone: 'success'});
  }
  if (current.action !== previous.action && current.action === 'hijacking') {
    notices.push({message: 'CARJACKING', tone: 'info'});
  }
  if (current.action !== previous.action && current.action === 'entering') {
    notices.push({message: 'ENTERING', tone: 'info'});
  }
  return notices;
}

function weaponAmmo(player: NetworkPlayer): number {
  if (player.weapon === 'grenade') return player.ammoGrenade;
  if (player.weapon === 'smg') return player.ammoSmg;
  if (player.weapon === 'shotgun') return player.ammoShotgun;
  return player.ammoPistol;
}

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

import {
  medicalCareDefinition,
  type MedicalCareKind
} from '../../../shared/content/medical-care.ts';
import {
  STREET_SERVICE_RADIUS,
  medicalTreatmentQuote
} from '../../../shared/content/street-services.ts';
import type {GameNotice} from '../../../shared/protocol/notices.ts';
import {StreetServiceState, type DistrictState, type PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {StreetEconomyPort, StreetEconomyResult} from '../economy/street-economy-controller.ts';
import {
  STREET_SPACE_ID,
  interiorDefinition,
  interiorServiceAnchor
} from '../../../shared/content/interior-catalog.ts';

const PLAYER_RADIUS = 11;

interface MedicalAdmission {
  id: string;
  playerId: string;
  deathX: number;
  deathY: number;
  admittedAt: number;
  care: MedicalCareKind;
}

interface MedicalCareControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  economy: StreetEconomyPort;
  clock: () => {tick: number};
  notice: (playerId: string, message: string, tone: GameNotice['tone']) => void;
}

export interface MedicalRespawnPlan {
  x: number;
  y: number;
  angle: number;
  spaceId: string;
  care: MedicalCareKind;
  restoreAmmo: boolean;
}

export class MedicalCareController {
  private readonly admissions = new Map<string, MedicalAdmission>();
  private initialized = false;

  constructor(private readonly options: MedicalCareControllerOptions) {}

  initialize(): void {
    if (this.initialized) return;
    const mercy = interiorServiceAnchor('hospital-mercy');
    const southside = interiorServiceAnchor('hospital-southside');
    if (!mercy || !southside) throw new Error('Missing authored hospital interior service anchors.');
    this.addFacility(
      'hospital-mercy',
      'Mercy Hospital',
      mercy.x,
      mercy.y,
      mercy.spaceId
    );
    this.addFacility(
      'hospital-southside',
      'Southside Clinic',
      southside.x,
      southside.y,
      southside.spaceId
    );
    this.initialized = true;
  }

  begin(player: PlayerState, deathX: number, deathY: number, nowMs: number): void {
    const care = medicalCareDefinition('public');
    const admission: MedicalAdmission = {
      id: `medical:${player.id}:${this.options.clock().tick}`,
      playerId: player.id,
      deathX,
      deathY,
      admittedAt: nowMs,
      care: care.id
    };
    this.admissions.set(player.id, admission);
    player.respawnCare = care.id;
    player.respawnAt = nowMs + care.delayMs;
  }

  select(playerId: string, kind: MedicalCareKind, nowMs: number): boolean {
    const player = this.options.state.players.get(playerId);
    const admission = this.admissions.get(playerId);
    if (!player || player.alive || !admission) return false;
    if (kind === 'public') return admission.care === 'public';
    if (admission.care === kind) return true;
    const care = medicalCareDefinition(kind);
    const result = this.options.economy.debit(
      playerId,
      care.cost,
      'hospital',
      `${admission.id}:${kind}`,
      nowMs
    );
    if (result.status !== 'applied' && result.status !== 'duplicate') {
      this.noticeFailure(playerId, result, care.cost);
      return true;
    }
    admission.care = care.id;
    player.respawnCare = care.id;
    player.respawnAt = Math.max(nowMs + 250, admission.admittedAt + care.delayMs);
    this.options.notice(playerId, `${care.label} confirmed -$${care.cost}`, 'success');
    return true;
  }

  complete(playerId: string, nowMs: number): MedicalRespawnPlan {
    const admission = this.admissions.get(playerId);
    const care = medicalCareDefinition(admission?.care ?? 'public');
    const facility = this.nearestFacility(
      admission?.deathX ?? this.options.world.spawn.x,
      admission?.deathY ?? this.options.world.spawn.y
    );
    const interior = facility ? interiorDefinition(facility.spaceId) : undefined;
    const recovery = interior?.recoveryAnchor;
    const center = facility ?? this.options.world.spawn;
    const spawn = recovery ?? this.options.world.openPointNear(
      center.x,
      center.y,
      0,
      92,
      PLAYER_RADIUS,
      nowMs + playerId.length * 41
    );
    this.admissions.delete(playerId);
    return {
      x: spawn.x,
      y: spawn.y,
      angle: recovery?.angle ?? -Math.PI / 2,
      spaceId: facility?.spaceId || STREET_SPACE_ID,
      care: care.id,
      restoreAmmo: care.restoreAmmo
    };
  }

  canTreat(player: PlayerState): boolean {
    return player.alive && !player.vehicleId && medicalTreatmentQuote(player.health) > 0;
  }

  treat(playerId: string, serviceId: string, nowMs: number): boolean {
    const player = this.options.state.players.get(playerId);
    const service = this.options.state.services.get(serviceId);
    if (!player || !service || service.kind !== 'hospital' || !this.canTreat(player)) return false;
    if (service.spaceId !== player.spaceId) return false;
    if (Math.hypot(player.x - service.x, player.y - service.y) > service.radius) return false;
    if (player.wanted > 0) {
      this.options.notice(playerId, 'Lose police heat before entering the hospital.', 'warning');
      return true;
    }
    const quote = medicalTreatmentQuote(player.health);
    const result = this.options.economy.debit(
      playerId,
      quote,
      'hospital',
      `service:${service.id}:${player.id}:${this.options.clock().tick}`,
      nowMs
    );
    if (result.status !== 'applied') {
      this.noticeFailure(playerId, result, quote);
      return true;
    }
    player.health = 100;
    this.options.notice(playerId, `Treatment complete -$${quote}`, 'success');
    return true;
  }

  clearPlayer(playerId: string): void {
    this.admissions.delete(playerId);
  }

  private nearestFacility(x: number, y: number): StreetServiceState | undefined {
    return [...this.options.state.services.values()]
      .filter((service) => service.kind === 'hospital')
      .sort((left, right) => (
        Math.hypot(left.x - x, left.y - y) - Math.hypot(right.x - x, right.y - y) ||
        left.id.localeCompare(right.id)
      ))[0];
  }

  private addFacility(
    id: string,
    label: string,
    x: number,
    y: number,
    spaceId = STREET_SPACE_ID
  ): void {
    const service = new StreetServiceState();
    service.id = id;
    service.kind = 'hospital';
    service.label = label;
    service.spaceId = spaceId;
    service.x = x;
    service.y = y;
    service.radius = STREET_SERVICE_RADIUS.hospital;
    this.options.state.services.set(id, service);
  }

  private noticeFailure(playerId: string, result: StreetEconomyResult, quote: number): void {
    const message = result.status === 'insufficient-funds'
      ? `Not enough cash. Care costs $${quote}.`
      : 'Medical service unavailable. Try again.';
    this.options.notice(playerId, message, 'warning');
  }
}

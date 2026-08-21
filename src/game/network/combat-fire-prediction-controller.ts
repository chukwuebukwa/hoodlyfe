import type {Room} from 'colyseus.js';
import {
  COMBAT_FIRE_MESSAGE,
  COMBAT_FIRE_RECEIPT_MESSAGE,
  COMBAT_PROTOCOL_VERSION,
  type CombatFireCommand,
  type CombatFireReceipt
} from '../../../shared/protocol/combat-fire.ts';
import {
  weaponDefinition,
  type BulletWeaponDefinition,
  type BulletWeaponId
} from '../../../shared/content/weapon-catalog.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {STREET_GROUND_SURFACE_ID} from '../../../shared/world/surface-map.ts';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';

const PROJECTILE_RADIUS = 4;
const PROJECTILE_STEP_DISTANCE = 4;
const RECEIPT_TIMEOUT_MS = 1_500;
const PRESENTATION_GRACE_MS = 250;

export interface PredictedProjectilePresentation {
  readonly clientSpawnId: number;
  readonly commandSequence: number;
  readonly authoritativeSpawnId?: string;
  readonly phase: 'pending' | 'confirmed';
  readonly surfaceId: string;
  readonly weapon: BulletWeaponId;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

interface CombatFirePredictionControllerOptions {
  readonly room: Room<DistrictNetworkState>;
  readonly getPlayer: () => NetworkPlayer | undefined;
  readonly getAimOrigin: () => {readonly x: number; readonly y: number} | undefined;
  readonly estimatedServerTimeMs: () => number;
  readonly canOccupy: (surfaceId: string, x: number, y: number, radius: number) => boolean;
  readonly now?: () => number;
  readonly onPredictedFire?: (
    weapon: BulletWeaponId,
    angle: number,
    player: NetworkPlayer
  ) => void;
  readonly onReceipt?: (receipt: CombatFireReceipt) => void;
  readonly combatRewindEnabled?: () => boolean;
  readonly projectilePredictionEnabled?: () => boolean;
}

interface PendingCommand {
  readonly sequence: number;
  readonly createdAtMs: number;
  readonly clientSpawnIds: readonly number[];
}

interface MutablePredictedProjectile extends PredictedProjectilePresentation {
  authoritativeSpawnId?: string;
  phase: 'pending' | 'confirmed';
  x: number;
  y: number;
  angle: number;
  lastAdvancedAtMs: number;
  expiresAtMs: number;
}

interface AuthoritativeBulletCollection {
  has(id: string): boolean;
}

export class CombatFirePredictionController {
  private readonly pendingCommands = new Map<number, PendingCommand>();
  private readonly projectiles = new Map<number, MutablePredictedProjectile>();
  private readonly cleanup: Array<() => void> = [];
  private readonly now: () => number;
  private authoritativeBulletIds: AuthoritativeBulletCollection = EMPTY_BULLETS;
  private nextSequence = 1;
  private nextClientSpawnId = 1;
  private lastClientSampleTimeMs = 0;

  constructor(private readonly options: CombatFirePredictionControllerOptions) {
    this.now = options.now ?? (() => performance.now());
    const remove = options.room.onMessage<CombatFireReceipt>(
      COMBAT_FIRE_RECEIPT_MESSAGE,
      this.handleReceipt
    );
    if (typeof remove === 'function') this.cleanup.push(remove as () => void);
  }

  requestFire(angle: number, nowMs = this.now()): boolean {
    const player = this.options.getPlayer();
    if (!player?.alive || !Number.isFinite(angle)) return false;
    const weapon = weaponDefinition(player.weapon);
    const bulletWeapon = weapon.fireMode === 'bullet' ? weapon : undefined;
    if ((player.spaceId || STREET_SPACE_ID) !== STREET_SPACE_ID) {
      if (bulletWeapon) this.options.onPredictedFire?.(bulletWeapon.id, angle, player);
      this.options.room.send('shoot');
      return true;
    }
    if (this.options.combatRewindEnabled && !this.options.combatRewindEnabled()) {
      if (bulletWeapon) this.options.onPredictedFire?.(bulletWeapon.id, angle, player);
      this.options.room.send('shoot');
      return true;
    }
    const origin = bulletWeapon ? this.options.getAimOrigin() : undefined;
    if (bulletWeapon && !origin) return false;

    const sequence = this.nextSequence++;
    const clientSpawnIds = bulletWeapon
      ? Array.from({length: bulletWeapon.pellets}, () => this.nextClientSpawnId++)
      : [];
    const sample = this.options.estimatedServerTimeMs();
    this.lastClientSampleTimeMs = Math.max(
      this.lastClientSampleTimeMs,
      Number.isFinite(sample) && sample >= 0 ? sample : 0
    );
    const command: CombatFireCommand = Object.freeze({
      protocolVersion: COMBAT_PROTOCOL_VERSION,
      sequence,
      clientSampleTimeMs: this.lastClientSampleTimeMs,
      controlledEntityId: player.id,
      aimAngle: angle,
      predictedSpawnIds: Object.freeze(clientSpawnIds)
    });
    this.pendingCommands.set(sequence, Object.freeze({
      sequence,
      createdAtMs: nowMs,
      clientSpawnIds: command.predictedSpawnIds
    }));
    if (bulletWeapon && origin && (this.options.projectilePredictionEnabled?.() ?? true)) {
      this.createPredictedProjectiles(
        sequence,
        clientSpawnIds,
        bulletWeapon,
        origin,
        player.surfaceId ?? STREET_GROUND_SURFACE_ID,
        angle,
        nowMs
      );
      this.options.onPredictedFire?.(bulletWeapon.id, angle, player);
    }
    this.options.room.send(COMBAT_FIRE_MESSAGE, command);
    return true;
  }

  update(nowMs = this.now()): readonly PredictedProjectilePresentation[] {
    for (const [sequence, command] of this.pendingCommands) {
      if (nowMs - command.createdAtMs <= RECEIPT_TIMEOUT_MS) continue;
      this.removeProjectiles(command.clientSpawnIds);
      this.pendingCommands.delete(sequence);
    }
    for (const [clientSpawnId, projectile] of this.projectiles) {
      if (nowMs >= projectile.expiresAtMs) {
        this.projectiles.delete(clientSpawnId);
        continue;
      }
      this.advanceProjectile(projectile, nowMs);
    }
    return [...this.projectiles.values()].map((projectile) => Object.freeze({
      clientSpawnId: projectile.clientSpawnId,
      commandSequence: projectile.commandSequence,
      authoritativeSpawnId: projectile.authoritativeSpawnId,
      phase: projectile.phase,
      surfaceId: projectile.surfaceId,
      weapon: projectile.weapon,
      x: projectile.x,
      y: projectile.y,
      angle: projectile.angle
    }));
  }

  synchronizeAuthoritative(bullets?: AuthoritativeBulletCollection): void {
    this.authoritativeBulletIds = bullets ?? EMPTY_BULLETS;
    for (const [clientSpawnId, projectile] of this.projectiles) {
      const authoritativeId = projectile.authoritativeSpawnId;
      if (authoritativeId && this.authoritativeBulletIds.has(authoritativeId)) {
        this.projectiles.delete(clientSpawnId);
      }
    }
  }

  destroy(): void {
    for (const remove of this.cleanup.splice(0)) remove();
    this.pendingCommands.clear();
    this.projectiles.clear();
  }

  private createPredictedProjectiles(
    sequence: number,
    clientSpawnIds: readonly number[],
    weapon: BulletWeaponDefinition,
    origin: {readonly x: number; readonly y: number},
    surfaceId: string,
    aimAngle: number,
    nowMs: number
  ): void {
    for (let pellet = 0; pellet < clientSpawnIds.length; pellet++) {
      const spread = weapon.pellets === 1
        ? 0
        : ((pellet / (weapon.pellets - 1)) - 0.5) * weapon.spread;
      const angle = aimAngle + spread;
      const clientSpawnId = clientSpawnIds[pellet];
      this.projectiles.set(clientSpawnId, {
        clientSpawnId,
        commandSequence: sequence,
        phase: 'pending',
        surfaceId,
        weapon: weapon.id,
        x: origin.x + Math.cos(angle) * 18,
        y: origin.y + Math.sin(angle) * 18,
        angle,
        lastAdvancedAtMs: nowMs,
        expiresAtMs: nowMs + weapon.lifetimeMs + PRESENTATION_GRACE_MS
      });
    }
  }

  private advanceProjectile(projectile: MutablePredictedProjectile, nowMs: number): void {
    const elapsedSeconds = Math.max(0, Math.min(0.1, (nowMs - projectile.lastAdvancedAtMs) / 1_000));
    projectile.lastAdvancedAtMs = nowMs;
    if (elapsedSeconds <= 0) return;
    const definition = weaponDefinition(projectile.weapon);
    if (definition.fireMode !== 'bullet') return;
    const distance = definition.projectileSpeed * elapsedSeconds;
    const steps = Math.max(1, Math.ceil(distance / PROJECTILE_STEP_DISTANCE));
    const stepDistance = distance / steps;
    for (let step = 0; step < steps; step++) {
      const x = projectile.x + Math.cos(projectile.angle) * stepDistance;
      const y = projectile.y + Math.sin(projectile.angle) * stepDistance;
      if (!this.options.canOccupy(projectile.surfaceId, x, y, PROJECTILE_RADIUS)) {
        this.projectiles.delete(projectile.clientSpawnId);
        return;
      }
      projectile.x = x;
      projectile.y = y;
    }
  }

  private readonly handleReceipt = (receipt: CombatFireReceipt): void => {
    if (receipt?.protocolVersion !== COMBAT_PROTOCOL_VERSION) return;
    const command = this.pendingCommands.get(receipt.sequence);
    if (!command) return;
    this.options.onReceipt?.(receipt);
    if (!receipt.accepted) {
      this.removeProjectiles(command.clientSpawnIds);
      this.pendingCommands.delete(command.sequence);
      return;
    }
    if (!validAcceptedReceipt(receipt, command)) {
      this.removeProjectiles(command.clientSpawnIds);
      this.pendingCommands.delete(command.sequence);
      return;
    }
    const receiptAt = this.now();
    for (const correlated of receipt.projectiles ?? []) {
      const projectile = this.projectiles.get(correlated.clientSpawnId);
      if (correlated.status === 'resolved') {
        this.projectiles.delete(correlated.clientSpawnId);
        continue;
      }
      if (!projectile) continue;
      projectile.authoritativeSpawnId = correlated.authoritativeSpawnId;
      projectile.phase = 'confirmed';
      projectile.x = correlated.x;
      projectile.y = correlated.y;
      projectile.angle = correlated.angle;
      projectile.lastAdvancedAtMs = receiptAt;
      if (this.authoritativeBulletIds.has(correlated.authoritativeSpawnId)) {
        this.projectiles.delete(correlated.clientSpawnId);
      }
    }
    this.pendingCommands.delete(command.sequence);
  };

  private removeProjectiles(clientSpawnIds: readonly number[]): void {
    for (const clientSpawnId of clientSpawnIds) this.projectiles.delete(clientSpawnId);
  }
}

function validAcceptedReceipt(receipt: CombatFireReceipt, command: PendingCommand): boolean {
  const projectiles = receipt.projectiles ?? [];
  if (projectiles.length !== command.clientSpawnIds.length) return false;
  const expected = new Set(command.clientSpawnIds);
  for (const projectile of projectiles) {
    if (
      !expected.delete(projectile.clientSpawnId) ||
      !projectile.authoritativeSpawnId ||
      (projectile.status !== 'active' && projectile.status !== 'resolved') ||
      !Number.isFinite(projectile.x) ||
      !Number.isFinite(projectile.y) ||
      !Number.isFinite(projectile.angle)
    ) return false;
  }
  return expected.size === 0;
}

const EMPTY_BULLETS: AuthoritativeBulletCollection = Object.freeze({
  has: (_id: string) => false
});

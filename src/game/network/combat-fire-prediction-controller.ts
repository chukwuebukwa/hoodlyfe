import type {Room} from 'colyseus.js';
import {
  COMBAT_FIRE_MESSAGE,
  COMBAT_FIRE_RECEIPT_MESSAGE,
  type CombatFireCommand,
  type CombatFireReceipt
} from '../../../shared/protocol/combat-fire.ts';
import {INTERACTION_PROTOCOL_VERSION} from '../../../shared/protocol/interaction-contracts.ts';
import {
  weaponDefinition,
  type BulletWeaponDefinition,
  type BulletWeaponId
} from '../../../shared/content/weapon-catalog.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
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
  readonly weapon: BulletWeaponId;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface CombatFirePredictionMetrics {
  readonly pendingCommands: number;
  readonly predictedProjectiles: number;
  readonly confirmedProjectiles: number;
  readonly acceptedCommands: number;
  readonly rejectedCommands: number;
  readonly resolvedProjectiles: number;
  readonly authoritativeHandoffs: number;
  readonly timedOutCommands: number;
  readonly malformedReceipts: number;
}

interface CombatFirePredictionControllerOptions {
  readonly room: Room<DistrictNetworkState>;
  readonly getPlayer: () => NetworkPlayer | undefined;
  readonly getAimOrigin: () => {readonly x: number; readonly y: number} | undefined;
  readonly estimatedServerTimeMs: () => number;
  readonly canOccupy: (x: number, y: number, radius: number) => boolean;
  readonly now?: () => number;
  readonly onPredictedFire?: (weapon: BulletWeaponId) => void;
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
  private acceptedCommands = 0;
  private rejectedCommands = 0;
  private resolvedProjectiles = 0;
  private authoritativeHandoffs = 0;
  private timedOutCommands = 0;
  private malformedReceipts = 0;

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
    if ((player.spaceId || STREET_SPACE_ID) !== STREET_SPACE_ID) {
      const interiorWeapon = weaponDefinition(player.weapon);
      if (interiorWeapon.fireMode === 'bullet') {
        this.options.onPredictedFire?.(interiorWeapon.id);
      }
      this.options.room.send('shoot');
      return true;
    }
    if (this.options.combatRewindEnabled && !this.options.combatRewindEnabled()) {
      this.options.room.send('shoot');
      return true;
    }
    const weapon = weaponDefinition(player.weapon);
    const bulletWeapon = weapon.fireMode === 'bullet' ? weapon : undefined;
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
      protocolVersion: INTERACTION_PROTOCOL_VERSION,
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
    if (
      bulletWeapon && origin &&
      (this.options.projectilePredictionEnabled?.() ?? true)
    ) {
      this.createPredictedProjectiles(sequence, clientSpawnIds, bulletWeapon, origin, angle, nowMs);
      this.options.onPredictedFire?.(bulletWeapon.id);
    }
    this.options.room.send(COMBAT_FIRE_MESSAGE, command);
    return true;
  }

  update(nowMs = this.now()): readonly PredictedProjectilePresentation[] {
    for (const [sequence, command] of this.pendingCommands) {
      if (nowMs - command.createdAtMs <= RECEIPT_TIMEOUT_MS) continue;
      this.removeProjectiles(command.clientSpawnIds);
      this.pendingCommands.delete(sequence);
      this.timedOutCommands++;
    }
    for (const [clientSpawnId, projectile] of this.projectiles) {
      if (nowMs >= projectile.expiresAtMs) {
        this.projectiles.delete(clientSpawnId);
        continue;
      }
      this.advanceProjectile(projectile, nowMs);
    }
    return this.presentations();
  }

  synchronizeAuthoritative(bullets?: AuthoritativeBulletCollection): void {
    this.authoritativeBulletIds = bullets ?? EMPTY_BULLETS;
    for (const [clientSpawnId, projectile] of this.projectiles) {
      const authoritativeId = projectile.authoritativeSpawnId;
      if (!authoritativeId || !this.authoritativeBulletIds.has(authoritativeId)) continue;
      this.projectiles.delete(clientSpawnId);
      this.authoritativeHandoffs++;
    }
  }

  presentations(): readonly PredictedProjectilePresentation[] {
    return [...this.projectiles.values()].map((projectile) => Object.freeze({
      clientSpawnId: projectile.clientSpawnId,
      commandSequence: projectile.commandSequence,
      authoritativeSpawnId: projectile.authoritativeSpawnId,
      phase: projectile.phase,
      weapon: projectile.weapon,
      x: projectile.x,
      y: projectile.y,
      angle: projectile.angle
    }));
  }

  metrics(): CombatFirePredictionMetrics {
    let confirmedProjectiles = 0;
    for (const projectile of this.projectiles.values()) {
      if (projectile.phase === 'confirmed') confirmedProjectiles++;
    }
    return Object.freeze({
      pendingCommands: this.pendingCommands.size,
      predictedProjectiles: this.projectiles.size,
      confirmedProjectiles,
      acceptedCommands: this.acceptedCommands,
      rejectedCommands: this.rejectedCommands,
      resolvedProjectiles: this.resolvedProjectiles,
      authoritativeHandoffs: this.authoritativeHandoffs,
      timedOutCommands: this.timedOutCommands,
      malformedReceipts: this.malformedReceipts
    });
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
    const distance = bulletWeaponDefinition(projectile.weapon).projectileSpeed * elapsedSeconds;
    const steps = Math.max(1, Math.ceil(distance / PROJECTILE_STEP_DISTANCE));
    const stepDistance = distance / steps;
    for (let step = 0; step < steps; step++) {
      const x = projectile.x + Math.cos(projectile.angle) * stepDistance;
      const y = projectile.y + Math.sin(projectile.angle) * stepDistance;
      if (!this.options.canOccupy(x, y, PROJECTILE_RADIUS)) {
        this.projectiles.delete(projectile.clientSpawnId);
        return;
      }
      projectile.x = x;
      projectile.y = y;
    }
  }

  private readonly handleReceipt = (receipt: CombatFireReceipt): void => {
    const command = this.pendingCommands.get(receipt?.sequence);
    if (!command) return;
    if (receipt.status === 'rejected') {
      this.rejectedCommands++;
      this.removeProjectiles(command.clientSpawnIds);
      this.pendingCommands.delete(command.sequence);
      return;
    }
    if (!validAcceptedReceipt(receipt, command)) {
      this.malformedReceipts++;
      this.removeProjectiles(command.clientSpawnIds);
      this.pendingCommands.delete(command.sequence);
      return;
    }
    this.acceptedCommands++;
    const receiptAt = this.now();
    for (const correlated of receipt.projectiles) {
      const projectile = this.projectiles.get(correlated.clientSpawnId);
      if (correlated.status === 'resolved') {
        this.projectiles.delete(correlated.clientSpawnId);
        this.resolvedProjectiles++;
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
        this.authoritativeHandoffs++;
      }
    }
    this.pendingCommands.delete(command.sequence);
  };

  private removeProjectiles(clientSpawnIds: readonly number[]): void {
    for (const clientSpawnId of clientSpawnIds) this.projectiles.delete(clientSpawnId);
  }
}

function validAcceptedReceipt(receipt: CombatFireReceipt, command: PendingCommand): boolean {
  if (receipt.status !== 'accepted' || !Array.isArray(receipt.projectiles)) return false;
  if (receipt.projectiles.length !== command.clientSpawnIds.length) return false;
  const expected = new Set(command.clientSpawnIds);
  for (const projectile of receipt.projectiles) {
    if (
      !expected.delete(projectile.clientSpawnId) ||
      !projectile.authoritativeSpawnId ||
      (projectile.status !== 'active' && projectile.status !== 'resolved') ||
      (projectile.weapon !== 'pistol' && projectile.weapon !== 'smg' && projectile.weapon !== 'shotgun') ||
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

function bulletWeaponDefinition(weapon: BulletWeaponId): BulletWeaponDefinition {
  const definition = weaponDefinition(weapon);
  if (definition.fireMode !== 'bullet') throw new Error(`Expected bullet weapon ${weapon}.`);
  return definition;
}

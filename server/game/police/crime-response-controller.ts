import type {GameEventStream} from '../events/game-events.ts';
import type {CrimeKind} from '../incidents/crime-policy.ts';
import {IncidentRegistry, type Incident} from '../incidents/incident-registry.ts';
import {WitnessSystem} from '../incidents/witness-system.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {WantedSystem} from '../wanted/wanted-system.ts';
import {
  PoliceResponseAllocationSystem,
  type PoliceResponseAllocationDiagnostic,
  type PoliceResponseChange,
  type PoliceResponseFleetPlan,
  type PoliceResponseSuspect
} from './police-response-allocation-system.ts';
import {PursuitMemory, type PursuitRecord} from './pursuit-memory.ts';

interface CrimeClock {
  tick: number;
  nowMs: number;
}

interface CrimeResponseControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  clock: () => CrimeClock;
  queryNpcs: (x: number, y: number, radius: number) => NpcState[];
  queryVehicles?: (x: number, y: number, radius: number) => VehicleState[];
  panicWitness: (witnessId: string, suspectId: string, untilMs: number) => void;
}

export interface PoliceTarget {
  player: PlayerState;
  pursuit?: PursuitRecord;
  canSeeTarget: boolean;
  targetDistance: number;
}

export interface PoliceVehicleTargetSnapshot {
  suspectId: string;
  wantedLevel: number;
  reportedX: number;
  reportedY: number;
  reportedAt: number;
  currentX: number;
  currentY: number;
  currentAngle: number;
  currentSpeed: number;
  targetVehicleId: string;
}

export class CrimeResponseController {
  private readonly incidents = new IncidentRegistry();
  private readonly witnesses = new WitnessSystem();
  private readonly wanted = new WantedSystem();
  private readonly responseAllocation = new PoliceResponseAllocationSystem();
  private readonly pursuitMemory = new PursuitMemory();
  private readonly reportedSuspectLocations = new Map<
    string,
    {x: number; y: number; reportedAt: number}
  >();

  constructor(private readonly options: CrimeResponseControllerOptions) {}

  record(
    playerId: string,
    kind: CrimeKind,
    nowMs: number,
    victimId = '',
    x?: number,
    y?: number
  ): void {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive) return;
    const result = this.incidents.register({
      kind,
      suspectId: playerId,
      victimId,
      x: x ?? player.x,
      y: y ?? player.y,
      nowMs
    });
    this.wanted.noteCrime(playerId, nowMs);
    if (!result.created) return;
    const incident = result.incident;
    const clock = this.options.clock();
    this.options.events.publish({
      type: 'crime.committed',
      tick: clock.tick,
      nowMs,
      incidentId: incident.id,
      suspectId: playerId,
      victimId,
      crimeKind: kind,
      severity: incident.severity,
      x: incident.x,
      y: incident.y
    });
    const report = this.witnesses.selectReporter(
      incident,
      this.witnessCandidates(incident),
      (fromX, fromY, toX, toY) => this.options.world.hasLineOfSight(fromX, fromY, toX, toY)
    );
    if (!report) return;
    this.incidents.scheduleReport(incident.id, report.witnessId, nowMs + report.delayMs);
    if (report.witnessKind === 'civilian') {
      this.options.panicWitness(report.witnessId, playerId, nowMs + 4500);
    }
  }

  processReports(nowMs: number): void {
    for (const incident of this.incidents.dueReports(nowMs)) {
      const suspect = this.options.state.players.get(incident.suspectId);
      this.incidents.markReported(incident.id, nowMs);
      if (!suspect?.alive) continue;
      const wanted = this.wanted.report(incident.suspectId, incident.severity, nowMs);
      suspect.wanted = wanted.level;
      this.reportedSuspectLocations.set(incident.suspectId, {
        x: incident.x,
        y: incident.y,
        reportedAt: nowMs
      });
      this.options.events.publish({
        type: 'incident.reported',
        tick: this.options.clock().tick,
        nowMs,
        incidentId: incident.id,
        suspectId: incident.suspectId,
        witnessId: incident.witnessId,
        wantedLevel: wanted.level
      });
    }
  }

  updateResponse(nowMs: number): void {
    const {state} = this.options;
    const units = [
      ...[...state.npcs.values()]
        .filter((npc) => npc.kind === 'police')
        .map((npc) => ({
          id: npc.id,
          kind: 'foot' as const,
          x: npc.x,
          y: npc.y,
          available: npc.alive
        })),
      ...[...state.vehicles.values()]
        .filter((vehicle) => vehicle.kind === 'police')
        .map((vehicle) => ({
          id: vehicle.id,
          kind: 'vehicle' as const,
          x: vehicle.x,
          y: vehicle.y,
          available: !vehicle.destroyed && !vehicle.hijackBy && !vehicle.driverId
        }))
    ];
    this.applyAllocationChanges(this.responseAllocation.update(
      this.responseSuspects(),
      units,
      nowMs
    ), nowMs);
  }

  private applyAllocationChanges(changes: readonly PoliceResponseChange[], nowMs: number): void {
    const {state} = this.options;
    for (const change of changes) {
      if (change.unitKind === 'foot' && change.suspectId) {
        const location = this.reportedSuspectLocations.get(change.suspectId);
        const officer = state.npcs.get(change.unitId);
        if (location) {
          this.pursuitMemory.assignSearch(
            change.unitId,
            change.suspectId,
            location.x,
            location.y,
            nowMs
          );
        } else if (officer) {
          this.pursuitMemory.assignSearch(
            change.unitId,
            change.suspectId,
            officer.x,
            officer.y,
            nowMs
          );
        }
      } else if (change.unitKind === 'foot') {
        this.pursuitMemory.clearOfficer(change.unitId);
      }
      this.options.events.publish({
        type: 'pursuit.changed',
        tick: this.options.clock().tick,
        nowMs,
        officerId: change.unitId,
        previousSuspectId: change.previousSuspectId,
        suspectId: change.suspectId
      });
    }
  }

  decay(player: PlayerState, nowMs: number): void {
    if (player.wanted === 0) return;
    const policeNearby = this.options.queryNpcs(player.x, player.y, 430)
      .some((npc) => npc.kind === 'police' && npc.alive) ||
      (this.options.queryVehicles?.(player.x, player.y, 520) ?? [])
        .some((vehicle) => vehicle.kind === 'police' && !vehicle.destroyed && vehicle.siren);
    player.wanted = this.wanted.tryDecay(player.id, nowMs, policeNearby).level;
  }

  policeVehicleTarget(vehicleId: string): PoliceVehicleTargetSnapshot | undefined {
    const assignment = this.responseAllocation.assignmentFor('vehicle', vehicleId);
    return assignment ? this.vehicleTargetSnapshot(assignment.suspectId) : undefined;
  }

  forgetPoliceVehicleTarget(
    vehicleId: string,
    suspectId: string,
    reportedAt: number,
    nowMs: number
  ): void {
    const change = this.responseAllocation.suppressReport(
      'vehicle',
      vehicleId,
      suspectId,
      reportedAt,
      nowMs
    );
    if (change) this.applyAllocationChanges([change], nowMs);
  }

  responseFleetPlan(): PoliceResponseFleetPlan {
    return this.responseAllocation.fleetPlan();
  }

  responseAllocationSnapshot(): PoliceResponseAllocationDiagnostic {
    return this.responseAllocation.diagnostics();
  }

  policeTarget(officer: NpcState, nowMs: number): PoliceTarget | undefined {
    const targetId = this.responseAllocation.assignmentFor('foot', officer.id)?.suspectId;
    const player = targetId ? this.options.state.players.get(targetId) : undefined;
    if (!player?.alive || player.wanted <= 0) return undefined;
    const targetDistance = Math.hypot(player.x - officer.x, player.y - officer.y);
    const canSeeTarget = targetDistance <= 620 && this.options.world.hasLineOfSight(
      officer.x,
      officer.y,
      player.x,
      player.y
    );
    const pursuit = canSeeTarget
      ? this.pursuitMemory.observe(officer.id, player.id, player.x, player.y, nowMs)
      : this.pursuitMemory.search(officer.id, player.id, nowMs);
    if (!pursuit) {
      const report = this.reportedSuspectLocations.get(player.id);
      if (report) {
        const change = this.responseAllocation.suppressReport(
          'foot',
          officer.id,
          player.id,
          report.reportedAt,
          nowMs
        );
        if (change) this.applyAllocationChanges([change], nowMs);
      }
      return undefined;
    }
    return {player, pursuit, canSeeTarget, targetDistance};
  }

  clearSuspect(suspectId: string): void {
    const nowMs = this.options.clock().nowMs;
    this.incidents.clearSuspect(suspectId);
    this.wanted.reset(suspectId);
    this.applyAllocationChanges(this.responseAllocation.clearSuspect(suspectId, nowMs), nowMs);
    this.pursuitMemory.clearSuspect(suspectId);
    this.reportedSuspectLocations.delete(suspectId);
  }

  expire(nowMs: number): void {
    this.incidents.expire(nowMs);
  }

  incidentSnapshot(): Incident[] {
    return this.incidents.snapshot();
  }

  pursuitSnapshot(): PursuitRecord[] {
    return this.pursuitMemory.entries();
  }

  private witnessCandidates(incident: Incident) {
    return this.options.queryNpcs(incident.x, incident.y, 760).map((npc) => ({
      id: npc.id,
      kind: npc.kind === 'police' ? 'police' as const : 'civilian' as const,
      x: npc.x,
      y: npc.y,
      alive: npc.alive
    }));
  }

  private responseSuspects(): PoliceResponseSuspect[] {
    return [...this.options.state.players.values()].flatMap((player) => {
      const report = this.reportedSuspectLocations.get(player.id);
      if (!player.alive || player.spaceId !== 'street' || player.wanted <= 0 || !report) return [];
      return [{
        id: player.id,
        wantedLevel: player.wanted,
        reportAt: report.reportedAt,
        reportedX: report.x,
        reportedY: report.y,
        currentX: player.x,
        currentY: player.y
      }];
    });
  }

  private vehicleTargetSnapshot(suspectId: string): PoliceVehicleTargetSnapshot | undefined {
    const player = this.options.state.players.get(suspectId);
    const report = this.reportedSuspectLocations.get(suspectId);
    if (!player?.alive || player.spaceId !== 'street' || player.wanted <= 0 || !report) {
      return undefined;
    }
    const vehicle = player.vehicleId
      ? this.options.state.vehicles.get(player.vehicleId)
      : undefined;
    return {
      suspectId: player.id,
      wantedLevel: player.wanted,
      reportedX: report.x,
      reportedY: report.y,
      reportedAt: report.reportedAt,
      currentX: player.x,
      currentY: player.y,
      currentAngle: vehicle?.angle ?? player.angle,
      currentSpeed: vehicle?.speed ?? 0,
      targetVehicleId: vehicle?.id ?? ''
    };
  }
}

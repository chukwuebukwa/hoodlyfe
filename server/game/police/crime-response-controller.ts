import type {GameEventStream} from '../events/game-events.ts';
import type {CrimeKind} from '../incidents/crime-policy.ts';
import {IncidentRegistry, type Incident} from '../incidents/incident-registry.ts';
import {WitnessSystem} from '../incidents/witness-system.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {WantedSystem} from '../wanted/wanted-system.ts';
import type {
  PoliceAwarenessMessage,
  PoliceAwarenessPhase,
  PoliceSearchZone
} from '../../../shared/protocol/police-awareness.ts';
import {
  PoliceResponseAllocationSystem,
  type PoliceResponseAllocationDiagnostic,
  type PoliceResponseChange,
  type PoliceResponseFleetPlan,
  type PoliceResponseSuspect
} from './police-response-allocation-system.ts';
import {PursuitMemory, type PursuitRecord} from './pursuit-memory.ts';
import {
  PursuitCoordinator,
  type PoliceTactic,
  type PoliceTacticalPhase,
  type PoliceTacticalRole
} from './pursuit-coordinator.ts';
import {
  POLICE_AWARENESS,
  policeFieldOfViewContains,
  policeSearchZone
} from './police-awareness-policy.ts';
import type {PoliceHelicopterTarget} from './police-helicopter-controller.ts';

interface CrimeClock {
  tick: number;
  nowMs: number;
}

interface PoliceAwarenessRuntime {
  phase: PoliceAwarenessPhase;
  lastKnownX: number;
  lastKnownY: number;
  lastSeenAt: number;
  searchStartedAt: number;
}

interface CrimeResponseControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  clock: () => CrimeClock;
  queryNpcs: (x: number, y: number, radius: number) => NpcState[];
  panicWitness: (witnessId: string, suspectId: string, untilMs: number) => void;
  isReservedPoliceUnit?: (kind: 'foot' | 'vehicle', unitId: string) => boolean;
  queryAerialSearchZones?: (suspectId: string) => readonly PoliceSearchZone[];
}

export interface PoliceTarget {
  player: PlayerState;
  pursuit?: PursuitRecord;
  canSeeTarget: boolean;
  targetDistance: number;
  tactic: PoliceTactic;
  targetAction: string;
  wantedLevel: number;
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
  tacticalRole: PoliceTacticalRole;
}

export class CrimeResponseController {
  private readonly incidents = new IncidentRegistry();
  private readonly witnesses = new WitnessSystem();
  private readonly wanted = new WantedSystem();
  private readonly responseAllocation = new PoliceResponseAllocationSystem();
  private readonly pursuitMemory = new PursuitMemory();
  private readonly pursuitCoordinator = new PursuitCoordinator();
  private readonly awareness = new Map<string, PoliceAwarenessRuntime>();
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
      const awareness = this.awareness.get(incident.suspectId);
      if (!awareness) {
        this.awareness.set(incident.suspectId, {
          phase: 'searching',
          lastKnownX: incident.x,
          lastKnownY: incident.y,
          lastSeenAt: Number.NEGATIVE_INFINITY,
          searchStartedAt: nowMs
        });
      } else if (awareness.phase !== 'spotted') {
        awareness.lastKnownX = incident.x;
        awareness.lastKnownY = incident.y;
        awareness.searchStartedAt = nowMs;
      }
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
    const suspects = this.responseSuspects();
    const units = [
      ...[...state.npcs.values()]
        .filter((npc) => (
          npc.kind === 'police' && !this.options.isReservedPoliceUnit?.('foot', npc.id)
        ))
        .map((npc) => ({
          id: npc.id,
          kind: 'foot' as const,
          x: npc.x,
          y: npc.y,
          available: npc.alive
        })),
      ...[...state.vehicles.values()]
        .filter((vehicle) => (
          vehicle.kind === 'police' && !this.options.isReservedPoliceUnit?.('vehicle', vehicle.id)
        ))
        .map((vehicle) => ({
          id: vehicle.id,
          kind: 'vehicle' as const,
          x: vehicle.x,
          y: vehicle.y,
          available: !vehicle.destroyed && !vehicle.hijackBy && !vehicle.driverId
        }))
    ];
    this.applyAllocationChanges(this.responseAllocation.update(suspects, units, nowMs), nowMs);
    this.pursuitCoordinator.update(this.responseAllocation.entries());
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
    const awareness = this.resolveAwareness(player.id, nowMs);
    player.wanted = this.wanted.tryDecay(
      player.id,
      nowMs,
      awareness?.phase === 'spotted'
    ).level;
    if (player.wanted === 0) this.awareness.delete(player.id);
  }

  policeVehicleTarget(vehicleId: string): PoliceVehicleTargetSnapshot | undefined {
    const assignment = this.responseAllocation.assignmentFor('vehicle', vehicleId);
    return assignment ? this.vehicleTargetSnapshot(vehicleId, assignment.suspectId) : undefined;
  }

  recordPoliceVehicleTactic(
    vehicleId: string,
    phase: PoliceTacticalPhase,
    goalX: number,
    goalY: number
  ): void {
    this.pursuitCoordinator.record('vehicle', vehicleId, phase, goalX, goalY);
  }

  recordPoliceFootTactic(
    officerId: string,
    phase: PoliceTacticalPhase,
    goalX: number,
    goalY: number
  ): void {
    this.pursuitCoordinator.record('foot', officerId, phase, goalX, goalY);
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

  deployPoliceVehicleCrew(
    vehicleId: string,
    suspectId: string,
    officers: readonly NpcState[],
    nowMs: number
  ): void {
    const changes = this.responseAllocation.deployVehicleCrew(
      vehicleId,
      suspectId,
      officers.map((officer) => ({
        id: officer.id,
        kind: 'foot' as const,
        x: officer.x,
        y: officer.y,
        available: officer.alive
      })),
      nowMs
    );
    this.applyAllocationChanges(changes, nowMs);
    this.pursuitCoordinator.update(this.responseAllocation.entries());
  }

  responseAllocationSnapshot(): PoliceResponseAllocationDiagnostic {
    return this.responseAllocation.diagnostics();
  }

  policeTarget(officer: NpcState, nowMs: number): PoliceTarget | undefined {
    const targetId = this.responseAllocation.assignmentFor('foot', officer.id)?.suspectId;
    const player = targetId ? this.options.state.players.get(targetId) : undefined;
    if (!player?.alive || player.wanted <= 0) return undefined;
    const targetDistance = Math.hypot(player.x - officer.x, player.y - officer.y);
    const canSeeTarget = policeFieldOfViewContains('foot', officer, player) &&
      this.options.world.hasLineOfSight(
        officer.x,
        officer.y,
        player.x,
        player.y
      );
    this.recordPoliceObservation(player, canSeeTarget, nowMs);
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
    const vehicle = player.vehicleId ? this.options.state.vehicles.get(player.vehicleId) : undefined;
    const tactic = this.pursuitCoordinator.resolve(
      'foot',
      officer.id,
      pursuit.mode,
      canSeeTarget,
      {
        x: pursuit.lastKnownX,
        y: pursuit.lastKnownY,
        angle: vehicle?.angle ?? player.angle,
        inVehicle: Boolean(vehicle)
      }
    );
    return {
      player,
      pursuit,
      canSeeTarget,
      targetDistance,
      tactic,
      targetAction: player.action,
      wantedLevel: player.wanted
    };
  }

  recordPoliceVehicleObservation(
    suspectId: string,
    canSeeTarget: boolean,
    nowMs: number
  ): void {
    const player = this.options.state.players.get(suspectId);
    if (player?.alive && player.wanted > 0) {
      this.recordPoliceObservation(player, canSeeTarget, nowMs);
    }
  }

  recordPoliceHelicopterObservation(
    suspectId: string,
    canSeeTarget: boolean,
    nowMs: number
  ): void {
    const player = this.options.state.players.get(suspectId);
    if (player?.alive && player.wanted >= 4) {
      this.recordPoliceObservation(player, canSeeTarget, nowMs);
    }
  }

  policeHelicopterTargets(nowMs: number): PoliceHelicopterTarget[] {
    return [...this.options.state.players.values()].flatMap((player) => {
      if (!player.alive || player.spaceId !== 'street' || player.wanted < 4) return [];
      const awareness = this.resolveAwareness(player.id, nowMs);
      if (!awareness || awareness.phase === 'clear') return [];
      return [{
        suspectId: player.id,
        wantedLevel: player.wanted,
        awareness: awareness.phase,
        currentX: player.x,
        currentY: player.y,
        lastKnownX: awareness.lastKnownX,
        lastKnownY: awareness.lastKnownY
      }];
    }).sort((left, right) => (
      right.wantedLevel - left.wantedLevel || left.suspectId.localeCompare(right.suspectId)
    ));
  }

  policeAwarenessSnapshot(suspectId: string, nowMs: number): PoliceAwarenessMessage {
    const player = this.options.state.players.get(suspectId);
    if (!player?.alive || player.wanted <= 0 || player.spaceId !== 'street') {
      return {
        phase: 'clear',
        wantedLevel: 0,
        lastKnownX: 0,
        lastKnownY: 0,
        lastSeenAt: 0,
        searchStartedAt: 0,
        zones: []
      };
    }
    const runtime = this.resolveAwareness(suspectId, nowMs) ?? {
      phase: 'searching' as const,
      lastKnownX: player.x,
      lastKnownY: player.y,
      lastSeenAt: Number.NEGATIVE_INFINITY,
      searchStartedAt: nowMs
    };
    return {
      phase: runtime.phase,
      wantedLevel: player.wanted,
      lastKnownX: runtime.lastKnownX,
      lastKnownY: runtime.lastKnownY,
      lastSeenAt: Number.isFinite(runtime.lastSeenAt) ? runtime.lastSeenAt : 0,
      searchStartedAt: runtime.searchStartedAt,
      zones: runtime.phase === 'searching' ? this.searchZonesFor(suspectId) : []
    };
  }

  clearSuspect(suspectId: string): void {
    const nowMs = this.options.clock().nowMs;
    this.incidents.clearSuspect(suspectId);
    this.wanted.reset(suspectId);
    this.applyAllocationChanges(this.responseAllocation.clearSuspect(suspectId, nowMs), nowMs);
    this.pursuitMemory.clearSuspect(suspectId);
    this.pursuitCoordinator.clearSuspect(suspectId);
    this.reportedSuspectLocations.delete(suspectId);
    this.awareness.delete(suspectId);
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

  pursuitTacticsSnapshot(): PoliceTactic[] {
    return this.pursuitCoordinator.diagnostics();
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

  private recordPoliceObservation(
    player: PlayerState,
    canSeeTarget: boolean,
    nowMs: number
  ): void {
    if (!canSeeTarget) {
      this.resolveAwareness(player.id, nowMs);
      return;
    }
    const runtime = this.awareness.get(player.id) ?? {
      phase: 'spotted' as const,
      lastKnownX: player.x,
      lastKnownY: player.y,
      lastSeenAt: nowMs,
      searchStartedAt: 0
    };
    runtime.phase = 'spotted';
    runtime.lastKnownX = player.x;
    runtime.lastKnownY = player.y;
    runtime.lastSeenAt = nowMs;
    runtime.searchStartedAt = 0;
    this.awareness.set(player.id, runtime);
    const report = this.reportedSuspectLocations.get(player.id);
    if (report) {
      report.x = player.x;
      report.y = player.y;
    }
    this.wanted.holdDecay(player.id, nowMs);
  }

  private resolveAwareness(
    suspectId: string,
    nowMs: number
  ): PoliceAwarenessRuntime | undefined {
    const player = this.options.state.players.get(suspectId);
    if (!player?.alive || player.wanted <= 0) {
      this.awareness.delete(suspectId);
      return undefined;
    }
    const report = this.reportedSuspectLocations.get(suspectId);
    let runtime = this.awareness.get(suspectId);
    if (!runtime) {
      runtime = {
        phase: 'searching',
        lastKnownX: report?.x ?? player.x,
        lastKnownY: report?.y ?? player.y,
        lastSeenAt: Number.NEGATIVE_INFINITY,
        searchStartedAt: report?.reportedAt ?? nowMs
      };
      this.awareness.set(suspectId, runtime);
    }
    const recentlySeen = Number.isFinite(runtime.lastSeenAt) &&
      nowMs - runtime.lastSeenAt <= POLICE_AWARENESS.lostSightGraceMs;
    if (recentlySeen) {
      runtime.phase = 'spotted';
    } else if (runtime.phase !== 'searching') {
      runtime.phase = 'searching';
      runtime.searchStartedAt = nowMs;
    }
    return runtime;
  }

  private searchZonesFor(suspectId: string): PoliceSearchZone[] {
    const zones: PoliceSearchZone[] = [
      ...(this.options.queryAerialSearchZones?.(suspectId) ?? [])
    ];
    for (const assignment of this.responseAllocation.entries()) {
      if (assignment.suspectId !== suspectId) continue;
      if (assignment.unitKind === 'foot') {
        const officer = this.options.state.npcs.get(assignment.unitId);
        if (officer?.alive) zones.push(policeSearchZone('foot', officer.id, officer));
      } else {
        const vehicle = this.options.state.vehicles.get(assignment.unitId);
        if (vehicle && !vehicle.destroyed && !vehicle.hijackBy) {
          zones.push(policeSearchZone('vehicle', vehicle.id, vehicle));
        }
      }
    }
    return zones.sort((left, right) => left.id.localeCompare(right.id));
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

  private vehicleTargetSnapshot(
    vehicleId: string,
    suspectId: string
  ): PoliceVehicleTargetSnapshot | undefined {
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
      targetVehicleId: vehicle?.id ?? '',
      tacticalRole: this.pursuitCoordinator.roleFor('vehicle', vehicleId)
    };
  }
}

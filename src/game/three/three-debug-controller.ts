import type {Room} from 'colyseus.js';
import * as THREE from 'three';
import type {DebugSnapshot} from '../../../shared/protocol/debug.ts';
import {projectDebugPanel} from '../debug/debug-panel-policy.ts';
import {DebugSnapshotSubscription} from '../debug/debug-snapshot-subscription.ts';
import type {DistrictNetworkState} from '../types.ts';
import {serverYToThree} from './three-prototype-policy.ts';
import type {NetworkQualitySnapshot} from '../network/network-quality-controller.ts';
import type {NetcodeRolloutSnapshot} from '../network/netcode-rollout-controller.ts';
import type {ActorRenderPose, VehicleRenderPose} from '../rendering/render-types.ts';
import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import type {
  InteractionIslandMember,
  InteractionIslandSelection
} from '../prediction/interaction-island-selector.ts';
import {
  INTERACTION_ISLAND_DEBUG_COLOR,
  projectInteractionIslandDebug
} from '../debug/interaction-island-debug-policy.ts';

const DRAW_INTERVAL_MS = 100;

export class ThreeDebugController {
  private readonly group = new THREE.Group();
  private readonly subscription: DebugSnapshotSubscription;
  private readonly panel = document.querySelector('#debug-panel');
  private readonly toggle = document.querySelector<HTMLButtonElement>('#debug-toggle');
  private readonly shell = document.querySelector<HTMLElement>('#game-shell');
  private readonly eventList = document.querySelector<HTMLOListElement>('#debug-events');
  private readonly fields: Record<string, Element | null> = {
    clock: document.querySelector('#debug-clock'),
    players: document.querySelector('#debug-players'),
    npcs: document.querySelector('#debug-npcs'),
    vehicles: document.querySelector('#debug-vehicles'),
    bullets: document.querySelector('#debug-bullets'),
    spatial: document.querySelector('#debug-spatial'),
    streaming: document.querySelector('#debug-streaming'),
    population: document.querySelector('#debug-population'),
    dropped: document.querySelector('#debug-dropped'),
    deferred: document.querySelector('#debug-deferred'),
    eventsThisTick: document.querySelector('#debug-event-count'),
    incidents: document.querySelector('#debug-incidents'),
    pursuits: document.querySelector('#debug-pursuits'),
    cruisers: document.querySelector('#debug-cruisers'),
    response: document.querySelector('#debug-police-response'),
    arrests: document.querySelector('#debug-police-arrests'),
    stimuli: document.querySelector('#debug-stimuli'),
    signals: document.querySelector('#debug-signals'),
    junctions: document.querySelector('#debug-junctions'),
    trafficRisk: document.querySelector('#debug-traffic-risk'),
    roads: document.querySelector('#debug-roads'),
    region: document.querySelector('#debug-region'),
    latency: document.querySelector('#debug-latency'),
    patchGap: document.querySelector('#debug-patch-gap'),
    prediction: document.querySelector('#debug-prediction'),
    clockSync: document.querySelector('#debug-clock-sync'),
    interactionIsland: document.querySelector('#debug-interaction-island'),
    interactionReplay: document.querySelector('#debug-interaction-replay'),
    interactionSelection: document.querySelector('#debug-interaction-selection'),
    simulationPhases: document.querySelector('#debug-simulation-phases'),
    rollout: document.querySelector('#debug-netcode-rollout')
  };
  private snapshot?: DebugSnapshot;
  private state?: DistrictNetworkState;
  private visible = false;
  private lastDrawAt = Number.NEGATIVE_INFINITY;

  constructor(
    scene: THREE.Scene,
    private readonly room: Room<DistrictNetworkState>,
    private readonly surfaceHeightAt: (x: number, y: number) => number,
    private readonly networkQuality: () => NetworkQualitySnapshot | undefined,
    private readonly predictedVehiclePose: (vehicleId: string) => VehicleRenderPose | undefined = () => undefined,
    private readonly predictedPlayerPose: (playerId: string) => ActorRenderPose | undefined = () => undefined,
    private readonly interactionIsland: () => InteractionIslandSelection | undefined = () => undefined,
    private readonly netcodeRollout: () => NetcodeRolloutSnapshot | undefined = () => undefined
  ) {
    this.group.visible = false;
    scene.add(this.group);
    this.toggle?.addEventListener('click', this.handleToggle);
    window.addEventListener('keydown', this.handleKeyDown);
    this.subscription = new DebugSnapshotSubscription({
      room,
      onSnapshot: (snapshot) => {
        this.snapshot = snapshot;
        this.updatePanel();
      }
    });
    this.subscription.start();
  }

  update(state: DistrictNetworkState, nowMs: number): void {
    this.state = state;
    this.updatePanel();
    if (!this.visible || nowMs - this.lastDrawAt < DRAW_INTERVAL_MS) return;
    this.lastDrawAt = nowMs;
    this.drawWorld();
  }

  destroy(): void {
    this.subscription.destroy();
    this.toggle?.removeEventListener('click', this.handleToggle);
    window.removeEventListener('keydown', this.handleKeyDown);
    disposeChildren(this.group);
    this.group.removeFromParent();
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
    this.panel?.classList.toggle('hidden', !visible);
    this.toggle?.setAttribute('aria-pressed', String(visible));
    if (this.shell) this.shell.dataset.debug = visible ? 'visible' : 'hidden';
    if (visible) {
      this.lastDrawAt = Number.NEGATIVE_INFINITY;
      this.updatePanel();
      this.drawWorld();
    }
  }

  private updatePanel(): void {
    const projection = projectDebugPanel(
      this.state,
      this.snapshot,
      this.networkQuality(),
      this.interactionIsland(),
      this.netcodeRollout()
    );
    for (const [key, element] of Object.entries(this.fields)) {
      if (element) element.textContent = String(projection[key as keyof typeof projection]);
    }
    if (!this.eventList) return;
    this.eventList.replaceChildren(...projection.events.map((event) => {
      const item = document.createElement('li');
      item.textContent = event;
      return item;
    }));
  }

  private drawWorld(): void {
    disposeChildren(this.group);
    const state = this.state;
    if (!state) return;
    for (const player of state.players.values()) {
      if (!player.alive || player.vehicleId) continue;
      this.group.add(entityGlyph(
        player.x,
        player.y,
        player.angle,
        11,
        0x70dcff,
        this.surfaceHeightAt
      ));
    }
    for (const npc of state.npcs.values()) {
      if (!npc.alive) continue;
      const color = npc.kind === 'police' ? 0xff5e68 : (npc.kind === 'hostile' ? 0xff7a66 : 0xf4cf55);
      this.group.add(entityGlyph(npc.x, npc.y, npc.angle, 10, color, this.surfaceHeightAt));
    }
    for (const vehicle of state.vehicles.values()) {
      this.group.add(vehicleGlyph(
        vehicle.x,
        vehicle.y,
        vehicle.angle,
        vehicle.kind,
        0x9d8bff,
        this.surfaceHeightAt
      ));
    }
    const laneGraph = this.snapshot?.trafficLaneGraph;
    if (laneGraph) {
      const nodes = new Map(laneGraph.nodes.map((node) => [node.id, node]));
      for (const edge of laneGraph.edges) {
        const from = nodes.get(edge.fromNodeId);
        const to = nodes.get(edge.toNodeId);
        if (!from || !to) continue;
        const color = edge.kind === 'lane'
          ? 0x427866
          : edge.kind === 'connector' ? 0xf0b64c : 0xb47cff;
        this.group.add(debugLine([
          point(from.x, from.y, this.surfaceHeightAt(from.x, from.y) + 18),
          point(to.x, to.y, this.surfaceHeightAt(to.x, to.y) + 18)
        ], color));
      }
    }
    this.drawInteractionIsland(state);
    for (const bullet of state.bullets.values()) {
      this.group.add(debugLine([
        point(bullet.x, bullet.y, this.surfaceHeightAt(bullet.x, bullet.y) + 24),
        point(
          bullet.x + Math.cos(bullet.angle) * 18,
          bullet.y + Math.sin(bullet.angle) * 18,
          this.surfaceHeightAt(bullet.x, bullet.y) + 24
        )
      ], 0xffffff));
    }
    for (const entry of this.snapshot?.pedestrianAi ?? []) {
      const npc = state.npcs.get(entry.id);
      if (!npc || entry.waypointIndex >= entry.waypoints.length) continue;
      const points = [point(npc.x, npc.y, this.surfaceHeightAt(npc.x, npc.y) + 25)];
      for (let index = entry.waypointIndex; index < entry.waypoints.length; index++) {
        const waypoint = entry.waypoints[index];
        points.push(point(waypoint.x, waypoint.y, this.surfaceHeightAt(waypoint.x, waypoint.y) + 25));
      }
      this.group.add(debugLine(points, npc.kind === 'police' ? 0xff8890 : 0x69e1c2));
    }
    for (const entry of this.snapshot?.policeVehicles ?? []) {
      const vehicle = state.vehicles.get(entry.vehicleId);
      if (!vehicle || entry.waypoints.length === 0) continue;
      const points = [point(vehicle.x, vehicle.y, this.surfaceHeightAt(vehicle.x, vehicle.y) + 27)];
      for (const waypoint of entry.waypoints) {
        points.push(point(waypoint.x, waypoint.y, this.surfaceHeightAt(waypoint.x, waypoint.y) + 27));
      }
      this.group.add(debugLine(points, entry.strategy === 'ram' ? 0xff5e68 : 0x5bbcff));
    }
    for (const assignment of this.snapshot?.policeResponse?.assignments ?? []) {
      const suspect = state.players.get(assignment.suspectId);
      const unit = assignment.unitKind === 'foot'
        ? state.npcs.get(assignment.unitId)
        : state.vehicles.get(assignment.unitId);
      if (!unit || !suspect) continue;
      this.group.add(debugLine([
        point(unit.x, unit.y, this.surfaceHeightAt(unit.x, unit.y) + 32),
        point(suspect.x, suspect.y, this.surfaceHeightAt(suspect.x, suspect.y) + 32)
      ], assignment.unitKind === 'foot' ? 0xff6f78 : 0x58c8ff));
    }
    for (const tactic of this.snapshot?.policeTactics ?? []) {
      if (tactic.phase === 'observe') continue;
      const unit = tactic.unitKind === 'foot'
        ? state.npcs.get(tactic.unitId)
        : state.vehicles.get(tactic.unitId);
      if (!unit || !Number.isFinite(tactic.goalX) || !Number.isFinite(tactic.goalY)) continue;
      this.group.add(debugLine([
        point(unit.x, unit.y, this.surfaceHeightAt(unit.x, unit.y) + 35),
        point(tactic.goalX, tactic.goalY, this.surfaceHeightAt(tactic.goalX, tactic.goalY) + 35)
      ], policeTacticColor(tactic.phase)));
    }
    for (const arrest of this.snapshot?.policeArrests ?? []) {
      this.group.add(debugLine([
        point(arrest.officerX, arrest.officerY, this.surfaceHeightAt(arrest.officerX, arrest.officerY) + 39),
        point(arrest.suspectX, arrest.suspectY, this.surfaceHeightAt(arrest.suspectX, arrest.suspectY) + 39)
      ], 0xff3fa4));
    }
    const drawnJunctions = new Set<string>();
    for (const entry of this.snapshot?.trafficAi ?? []) {
      const vehicle = state.vehicles.get(entry.vehicleId);
      if (vehicle && entry.routeWaypoints.length > 0) {
        const points = [
          point(vehicle.x, vehicle.y, this.surfaceHeightAt(vehicle.x, vehicle.y) + 30),
          ...entry.routeWaypoints.map((waypoint) => point(
            waypoint.x,
            waypoint.y,
            this.surfaceHeightAt(waypoint.x, waypoint.y) + 30
          ))
        ];
        this.group.add(debugLine(points, entry.routeComplete ? 0x45d7ff : 0xff8b4d));
      }
      const junctionCenter = entry.junctionId
        ? trafficJunctionCenter(this.snapshot, entry.junctionId)
        : undefined;
      if (junctionCenter && vehicle && entry.junctionPhase !== 'none') {
        const color = junctionPhaseColor(entry.junctionPhase);
        if (
          entry.junctionPhase !== 'waiting' &&
          entry.junctionMovementPath.length >= 2
        ) {
          this.group.add(debugLine(entry.junctionMovementPath.map((movementPoint) => point(
            movementPoint.x,
            movementPoint.y,
            this.surfaceHeightAt(movementPoint.x, movementPoint.y) + 37
          )), entry.junctionActiveOwnerCount > 1 ? 0x5cffc9 : color));
        }
        this.group.add(debugLine([
          point(vehicle.x, vehicle.y, this.surfaceHeightAt(vehicle.x, vehicle.y) + 34),
          point(
            junctionCenter.x,
            junctionCenter.y,
            this.surfaceHeightAt(junctionCenter.x, junctionCenter.y) + 34
          )
        ], color));
        if (!drawnJunctions.has(entry.junctionId)) {
          drawnJunctions.add(entry.junctionId);
          this.group.add(debugRing(
            junctionCenter.x,
            junctionCenter.y,
            34,
            color,
            this.surfaceHeightAt(junctionCenter.x, junctionCenter.y) + 33
          ));
        }
      }
      const contactObstacle = entry.timeToContactSeconds >= 0
        ? trafficObstaclePosition(state, entry.obstacleId)
        : undefined;
      if (vehicle && contactObstacle) {
        this.group.add(debugLine([
          point(vehicle.x, vehicle.y, this.surfaceHeightAt(vehicle.x, vehicle.y) + 36),
          point(
            contactObstacle.x,
            contactObstacle.y,
            this.surfaceHeightAt(contactObstacle.x, contactObstacle.y) + 36
          )
        ], entry.timeToContactSeconds < 0.75 ? 0xff4f5e : 0xff9f43));
      }
      const deadlockObstacle = entry.deadlockCycleId
        ? trafficObstaclePosition(state, entry.obstacleId)
        : undefined;
      if (vehicle && deadlockObstacle) {
        const color = entry.deadlockRecovering ? 0xff2bd6 : 0xb86bff;
        this.group.add(debugLine([
          point(vehicle.x, vehicle.y, this.surfaceHeightAt(vehicle.x, vehicle.y) + 39),
          point(
            deadlockObstacle.x,
            deadlockObstacle.y,
            this.surfaceHeightAt(deadlockObstacle.x, deadlockObstacle.y) + 39
          )
        ], color));
        if (entry.deadlockRecovering) {
          this.group.add(debugRing(
            vehicle.x,
            vehicle.y,
            29,
            color,
            this.surfaceHeightAt(vehicle.x, vehicle.y) + 38
          ));
        }
      }
      if (vehicle && entry.laneChangeTargets.length > 0) {
        this.group.add(debugLine([
          point(vehicle.x, vehicle.y, this.surfaceHeightAt(vehicle.x, vehicle.y) + 41),
          ...entry.laneChangeTargets.map((target) => point(
            target.x,
            target.y,
            this.surfaceHeightAt(target.x, target.y) + 41
          ))
        ], entry.laneChangePhase === 'requesting' ? 0x8a9ab5 : 0x42a5ff));
        this.group.add(debugRing(
          entry.laneChangeTargets[0].x,
          entry.laneChangeTargets[0].y,
          18,
          0x42a5ff,
          this.surfaceHeightAt(
            entry.laneChangeTargets[0].x,
            entry.laneChangeTargets[0].y
          ) + 40
        ));
      }
      if (entry.emergencyYieldPhase === 'none' || !entry.emergencyVehicleId) continue;
      const emergency = state.vehicles.get(entry.emergencyVehicleId);
      if (!vehicle || !emergency) continue;
      this.group.add(debugLine([
        point(vehicle.x, vehicle.y, this.surfaceHeightAt(vehicle.x, vehicle.y) + 29),
        point(emergency.x, emergency.y, this.surfaceHeightAt(emergency.x, emergency.y) + 29)
      ], entry.emergencyYieldPhase === 'wait' ? 0xffd45b : 0x52e8ff));
    }
    for (const stimulus of this.snapshot?.stimuli ?? []) {
      this.group.add(debugRing(
        stimulus.x,
        stimulus.y,
        stimulus.radius,
        0xd979ff,
        this.surfaceHeightAt(stimulus.x, stimulus.y) + 23
      ));
    }
    for (const incident of this.snapshot?.incidents ?? []) {
      this.group.add(debugRing(
        incident.x,
        incident.y,
        18,
        incident.status === 'reported' ? 0x777777 : 0xff9d3f,
        this.surfaceHeightAt(incident.x, incident.y) + 26
      ));
    }
  }

  private drawInteractionIsland(state: DistrictNetworkState): void {
    const selection = this.interactionIsland();
    const projection = projectInteractionIslandDebug(
      selection,
      (member) => this.presentedIslandPose(member)
    );
    for (const link of projection.links) {
      this.group.add(debugLine([
        point(link.fromX, link.fromY, this.surfaceHeightAt(link.fromX, link.fromY) + 31),
        point(link.toX, link.toY, this.surfaceHeightAt(link.toX, link.toY) + 31)
      ], link.color));
    }
    for (const body of projection.bodies) {
      const entity = body.member.entity;
      this.group.add(interactionEntityGlyph(
        entity,
        entity.x,
        entity.y,
        entity.angle,
        body.color,
        this.surfaceHeightAt
      ));
      if (!body.presented) continue;
      this.group.add(interactionEntityGlyph(
        entity,
        body.presented.x,
        body.presented.y,
        body.presented.angle,
        INTERACTION_ISLAND_DEBUG_COLOR.presented,
        this.surfaceHeightAt
      ));
    }
    if (selection) return;
    const local = state.players.get(this.room.sessionId);
    if (!local) return;
    if (local.vehicleId) {
      const pose = this.predictedVehiclePose(local.vehicleId);
      if (!pose) return;
      this.group.add(vehicleGlyph(
        pose.x,
        pose.y,
        pose.angle,
        state.vehicles.get(local.vehicleId)?.kind ?? 'sedan',
        INTERACTION_ISLAND_DEBUG_COLOR.presented,
        this.surfaceHeightAt
      ));
      return;
    }
    const pose = this.predictedPlayerPose(local.id);
    if (pose) {
      this.group.add(entityGlyph(
        pose.x,
        pose.y,
        pose.angle,
        11,
        INTERACTION_ISLAND_DEBUG_COLOR.presented,
        this.surfaceHeightAt
      ));
    }
  }

  private presentedIslandPose(member: InteractionIslandMember): ActorRenderPose | undefined {
    if (member.entity.kind === 'vehicle') return this.predictedVehiclePose(member.entity.id);
    if (member.entity.kind === 'player') return this.predictedPlayerPose(member.entity.id);
    return undefined;
  }

  private readonly handleToggle = (event: Event): void => {
    event.stopPropagation();
    this.setVisible(!this.visible);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3') this.setVisible(!this.visible);
  };
}

function policeTacticColor(phase: string): number {
  if (phase === 'contain') return 0xffc857;
  if (phase === 'intercept') return 0x5bbcff;
  if (phase === 'search') return 0xb47cff;
  if (phase === 'disengage') return 0x7b828c;
  return 0xff6f78;
}

function trafficJunctionCenter(
  snapshot: DebugSnapshot | undefined,
  junctionId: string
): {x: number; y: number} | undefined {
  const nodes = snapshot?.trafficLaneGraph?.nodes.filter((node) => node.junctionId === junctionId) ?? [];
  if (nodes.length > 0) {
    return {
      x: nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
      y: nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length
    };
  }
  const [column, row] = junctionId.split(',').map(Number);
  return Number.isFinite(column) && Number.isFinite(row)
    ? {x: (column + 0.5) * 64, y: (row + 0.5) * 64}
    : undefined;
}

function trafficObstaclePosition(
  state: DistrictNetworkState,
  obstacleId: string
): {x: number; y: number} | undefined {
  const vehicle = state.vehicles.get(obstacleId);
  if (vehicle) return vehicle;
  if (obstacleId.startsWith('player:')) return state.players.get(obstacleId.slice('player:'.length));
  if (obstacleId.startsWith('npc:')) return state.npcs.get(obstacleId.slice('npc:'.length));
  return undefined;
}

function junctionPhaseColor(phase: string): number {
  if (phase === 'waiting') return 0xffb347;
  if (phase === 'approach') return 0xffe066;
  if (phase === 'crossing') return 0x58e58c;
  if (phase === 'clearing') return 0x55cfff;
  return 0x777777;
}

function entityGlyph(
  x: number,
  y: number,
  angle: number,
  radius: number,
  color: number,
  surface: (x: number, y: number) => number
): THREE.Group {
  const group = new THREE.Group();
  group.add(debugRing(0, 0, radius, color, 0));
  group.add(debugLine([
    new THREE.Vector3(),
    new THREE.Vector3(Math.cos(angle) * radius * 1.7, -Math.sin(angle) * radius * 1.7, 0)
  ], color));
  group.position.set(x, serverYToThree(y), surface(x, y) + 24);
  return group;
}

function vehicleGlyph(
  x: number,
  y: number,
  angle: number,
  kind: string,
  color: number,
  surface: (x: number, y: number) => number
): THREE.Group {
  const collision = vehicleDefinition(kind).collision;
  const halfLength = collision.length / 2;
  const halfWidth = collision.width / 2;
  const forward = new THREE.Vector2(Math.cos(angle), -Math.sin(angle));
  const side = new THREE.Vector2(-forward.y, forward.x);
  const points = [
    new THREE.Vector3(forward.x * halfLength + side.x * halfWidth, forward.y * halfLength + side.y * halfWidth, 0),
    new THREE.Vector3(forward.x * halfLength - side.x * halfWidth, forward.y * halfLength - side.y * halfWidth, 0),
    new THREE.Vector3(-forward.x * halfLength - side.x * halfWidth, -forward.y * halfLength - side.y * halfWidth, 0),
    new THREE.Vector3(-forward.x * halfLength + side.x * halfWidth, -forward.y * halfLength + side.y * halfWidth, 0)
  ];
  const group = new THREE.Group();
  const box = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.9, depthTest: false})
  );
  box.renderOrder = 40;
  group.add(box);
  group.add(debugLine([
    new THREE.Vector3(),
    new THREE.Vector3(forward.x * (halfLength + 9), forward.y * (halfLength + 9), 0)
  ], color));
  group.position.set(x, serverYToThree(y), surface(x, y) + 24);
  return group;
}

function interactionEntityGlyph(
  entity: InteractionIslandMember['entity'],
  x: number,
  y: number,
  angle: number,
  color: number,
  surface: (x: number, y: number) => number
): THREE.Group {
  if (entity.kind === 'vehicle') {
    return vehicleGlyph(x, y, angle, entity.vehicleKind, color, surface);
  }
  return entityGlyph(x, y, angle, entity.radius, color, surface);
}

function debugRing(x: number, y: number, radius: number, color: number, z: number): THREE.LineLoop {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 48; index++) {
    const angle = index / 48 * Math.PI * 2;
    points.push(new THREE.Vector3(x + Math.cos(angle) * radius, serverYToThree(y) + Math.sin(angle) * radius, z));
  }
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.9, depthTest: false})
  );
  line.renderOrder = 40;
  return line;
}

function debugLine(points: THREE.Vector3[], color: number): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.78, depthTest: false})
  );
  line.renderOrder = 40;
  return line;
}

function point(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, serverYToThree(y), z);
}

function disposeChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.removeFromParent();
    child.traverse((object) => {
      if (!(object instanceof THREE.Line) && !(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }
}

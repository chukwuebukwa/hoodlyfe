import type {Room} from 'colyseus.js';
import * as THREE from 'three';
import type {DebugSnapshot} from '../../../shared/protocol/debug.ts';
import {projectDebugPanel} from '../debug/debug-panel-policy.ts';
import {DebugSnapshotSubscription} from '../debug/debug-snapshot-subscription.ts';
import type {DistrictNetworkState} from '../types.ts';
import {serverYToThree} from './three-prototype-policy.ts';

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
    dropped: document.querySelector('#debug-dropped'),
    deferred: document.querySelector('#debug-deferred'),
    eventsThisTick: document.querySelector('#debug-event-count'),
    incidents: document.querySelector('#debug-incidents'),
    pursuits: document.querySelector('#debug-pursuits'),
    cruisers: document.querySelector('#debug-cruisers'),
    stimuli: document.querySelector('#debug-stimuli'),
    signals: document.querySelector('#debug-signals')
  };
  private snapshot?: DebugSnapshot;
  private state?: DistrictNetworkState;
  private visible = false;
  private lastDrawAt = Number.NEGATIVE_INFINITY;

  constructor(
    scene: THREE.Scene,
    room: Room<DistrictNetworkState>,
    private readonly surfaceHeightAt: (x: number, y: number) => number
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
    const projection = projectDebugPanel(this.state, this.snapshot);
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
      if (!player.alive) continue;
      this.group.add(entityGlyph(player.x, player.y, player.angle, 11, 0x70dcff, this.surfaceHeightAt));
    }
    for (const npc of state.npcs.values()) {
      if (!npc.alive) continue;
      const color = npc.kind === 'police' ? 0xff5e68 : (npc.kind === 'hostile' ? 0xff7a66 : 0xf4cf55);
      this.group.add(entityGlyph(npc.x, npc.y, npc.angle, 10, color, this.surfaceHeightAt));
    }
    for (const vehicle of state.vehicles.values()) {
      this.group.add(entityGlyph(vehicle.x, vehicle.y, vehicle.angle, 20, 0x9d8bff, this.surfaceHeightAt));
    }
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

  private readonly handleToggle = (event: Event): void => {
    event.stopPropagation();
    this.setVisible(!this.visible);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3') this.setVisible(!this.visible);
  };
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

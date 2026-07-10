import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import type {DebugSnapshot} from '../../../shared/protocol/debug.ts';
import type {DistrictNetworkState} from '../types.ts';
import {projectDebugPanel} from './debug-panel-policy.ts';
import {DebugSnapshotSubscription} from './debug-snapshot-subscription.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const SPATIAL_CELL_SIZE = 256;
const DRAW_INTERVAL_MS = 100;

export class DebugPresentationController {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly key: Phaser.Input.Keyboard.Key;
  private readonly subscription: DebugSnapshotSubscription;
  private readonly panel: Element | null;
  private readonly toggle: HTMLButtonElement | null;
  private readonly shell: HTMLElement | null;
  private readonly eventList: HTMLOListElement | null;
  private readonly fields: Record<string, Element | null>;
  private state?: DistrictNetworkState;
  private snapshot?: DebugSnapshot;
  private visible = false;
  private lastDrawAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly room: Room<DistrictNetworkState>,
    private readonly tilemap: Phaser.Tilemaps.Tilemap,
    private readonly collisionLayer: Phaser.Tilemaps.TilemapLayer,
    private readonly root: Document = document
  ) {
    if (!scene.input.keyboard) throw new Error('Keyboard input is unavailable.');
    this.graphics = scene.add.graphics().setDepth(980_000);
    this.key = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F3);
    this.panel = this.root.querySelector('#debug-panel');
    this.toggle = this.root.querySelector<HTMLButtonElement>('#debug-toggle');
    this.shell = this.root.querySelector<HTMLElement>('#game-shell');
    this.eventList = this.root.querySelector<HTMLOListElement>('#debug-events');
    this.fields = {
      clock: this.root.querySelector('#debug-clock'),
      players: this.root.querySelector('#debug-players'),
      npcs: this.root.querySelector('#debug-npcs'),
      vehicles: this.root.querySelector('#debug-vehicles'),
      bullets: this.root.querySelector('#debug-bullets'),
      spatial: this.root.querySelector('#debug-spatial'),
      dropped: this.root.querySelector('#debug-dropped'),
      deferred: this.root.querySelector('#debug-deferred'),
      eventsThisTick: this.root.querySelector('#debug-event-count'),
      incidents: this.root.querySelector('#debug-incidents'),
      pursuits: this.root.querySelector('#debug-pursuits'),
      stimuli: this.root.querySelector('#debug-stimuli')
    };
    this.toggle?.addEventListener('click', this.handleToggle);
    this.subscription = new DebugSnapshotSubscription({
      room,
      onSnapshot: (snapshot) => {
        this.snapshot = snapshot;
        this.updatePanel();
      }
    });
    this.subscription.start();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(state: DistrictNetworkState): void {
    this.state = state;
    this.updatePanel();
  }

  update(time: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.key)) this.setVisible(!this.visible);
    if (!this.visible || time - this.lastDrawAt < DRAW_INTERVAL_MS) return;
    this.lastDrawAt = time;
    this.drawWorld();
  }

  destroy(): void {
    this.subscription.destroy();
    this.toggle?.removeEventListener('click', this.handleToggle);
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
    this.graphics.destroy();
    this.state = undefined;
    this.snapshot = undefined;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.panel?.classList.toggle('hidden', !visible);
    this.toggle?.setAttribute('aria-pressed', String(visible));
    if (this.shell) this.shell.dataset.debug = visible ? 'visible' : 'hidden';
    if (visible) {
      this.lastDrawAt = Number.NEGATIVE_INFINITY;
      this.updatePanel();
      this.drawWorld();
      return;
    }
    this.graphics.clear();
    for (const label of this.labels.values()) label.setVisible(false);
  }

  private drawWorld(): void {
    if (!this.state) return;
    const view = this.scene.cameras.main.worldView;
    this.graphics.clear();
    this.drawCollision(view);
    this.drawSpatialGrid(view);
    const presentLabels = new Set<string>();
    this.drawPedestrianRoutes();
    this.drawPlayers(presentLabels);
    this.drawNpcs(presentLabels);
    this.drawVehicles(presentLabels);
    this.drawBullets();
    this.drawStimuli(presentLabels);
    this.drawIncidents(presentLabels);
    this.drawPursuits();
    for (const [key, label] of this.labels) {
      if (presentLabels.has(key)) continue;
      label.destroy();
      this.labels.delete(key);
    }
  }

  private drawCollision(view: Phaser.Geom.Rectangle): void {
    this.graphics.fillStyle(0xff3652, 0.2);
    const minX = Math.max(0, Math.floor(view.left / this.tilemap.tileWidth) - 1);
    const maxX = Math.min(this.tilemap.width - 1, Math.ceil(view.right / this.tilemap.tileWidth) + 1);
    const minY = Math.max(0, Math.floor(view.top / this.tilemap.tileHeight) - 1);
    const maxY = Math.min(this.tilemap.height - 1, Math.ceil(view.bottom / this.tilemap.tileHeight) + 1);
    for (let row = minY; row <= maxY; row++) {
      for (let column = minX; column <= maxX; column++) {
        if (!this.collisionLayer.hasTileAt(column, row)) continue;
        this.graphics.fillRect(
          column * this.tilemap.tileWidth,
          row * this.tilemap.tileHeight,
          this.tilemap.tileWidth,
          this.tilemap.tileHeight
        );
      }
    }
  }

  private drawSpatialGrid(view: Phaser.Geom.Rectangle): void {
    this.graphics.lineStyle(1, 0x70dcff, 0.34);
    const startX = Math.floor(view.left / SPATIAL_CELL_SIZE) * SPATIAL_CELL_SIZE;
    const startY = Math.floor(view.top / SPATIAL_CELL_SIZE) * SPATIAL_CELL_SIZE;
    for (let x = startX; x <= view.right; x += SPATIAL_CELL_SIZE) {
      this.graphics.lineBetween(x, view.top, x, view.bottom);
    }
    for (let y = startY; y <= view.bottom; y += SPATIAL_CELL_SIZE) {
      this.graphics.lineBetween(view.left, y, view.right, y);
    }
  }

  private drawPlayers(present: Set<string>): void {
    this.state?.players?.forEach((player, playerId) => {
      const mode = player.vehicleId ? `seat:${player.vehicleSeat}` : 'foot';
      this.drawEntity(
        player.x,
        player.y,
        PLAYER_RADIUS,
        player.angle,
        0x70dcff,
        `player:${playerId}`,
        `${player.name} p:${shortId(playerId)} ${mode} w:${player.wanted}`,
        present,
        player.alive
      );
    });
  }

  private drawNpcs(present: Set<string>): void {
    const diagnostics = new Map(
      (this.snapshot?.pedestrianAi ?? []).map((entry) => [entry.id, entry])
    );
    this.state?.npcs?.forEach((npc, npcId) => {
      const color = npc.kind === 'police' ? 0xff5e68 : 0xf4cf55;
      const diagnostic = diagnostics.get(npcId);
      const memory = diagnostic?.threatId
        ? ` threat:${shortId(diagnostic.threatId)}`
        : (diagnostic?.stimulusKind ? ` mem:${diagnostic.stimulusKind}` : '');
      const phase = diagnostic?.reactionPhase && diagnostic.reactionPhase !== 'none'
        ? ` phase:${diagnostic.reactionPhase}`
        : '';
      const path = diagnostic && diagnostic.waypointIndex < diagnostic.waypoints.length
        ? ` path:${diagnostic.waypointIndex + 1}/${diagnostic.waypoints.length}`
        : '';
      const ai = diagnostic
        ? ` ${diagnostic.objective} b:${diagnostic.bravery.toFixed(2)}${memory}${phase}${path}`
        : '';
      this.drawEntity(
        npc.x,
        npc.y,
        NPC_RADIUS,
        npc.angle,
        color,
        `npc:${npcId}`,
        `${npcId} hp:${npc.health}${ai}`,
        present,
        npc.alive
      );
    });
  }

  private drawPedestrianRoutes(): void {
    for (const diagnostic of this.snapshot?.pedestrianAi ?? []) {
      const npc = this.state?.npcs?.get(diagnostic.id);
      if (!npc || diagnostic.waypointIndex >= diagnostic.waypoints.length) continue;
      const color = npc.kind === 'police' ? 0xff8890 : 0x69e1c2;
      this.graphics.lineStyle(2, color, 0.62);
      let previousX = npc.x;
      let previousY = npc.y;
      for (let index = diagnostic.waypointIndex; index < diagnostic.waypoints.length; index++) {
        const waypoint = diagnostic.waypoints[index];
        this.graphics.lineBetween(previousX, previousY, waypoint.x, waypoint.y);
        this.graphics.strokeCircle(waypoint.x, waypoint.y, 4);
        previousX = waypoint.x;
        previousY = waypoint.y;
      }
      if (Number.isFinite(diagnostic.navigationGoalX) && Number.isFinite(diagnostic.navigationGoalY)) {
        this.graphics.lineStyle(1, color, 0.42);
        this.graphics.strokeCircle(diagnostic.navigationGoalX, diagnostic.navigationGoalY, 8);
      }
    }
  }

  private drawVehicles(present: Set<string>): void {
    const diagnostics = new Map(
      (this.snapshot?.trafficAi ?? []).map((entry) => [entry.vehicleId, entry])
    );
    this.state?.vehicles?.forEach((vehicle, vehicleId) => {
      const mode = vehicle.traffic
        ? 'traffic'
        : (vehicle.driverId ? `driver:${shortId(vehicle.driverId)}` : 'idle');
      const damage = `${vehicle.damageFront}/${vehicle.damageRear}/` +
        `${vehicle.damageLeft}/${vehicle.damageRight}`;
      const status = `${vehicle.onFire ? ' FIRE' : ''}${vehicle.destroyed ? ' WRECK' : ''}`;
      const diagnostic = diagnostics.get(vehicleId);
      const traffic = diagnostic
        ? ` ai:${diagnostic.speedReason} target:${Math.round(diagnostic.desiredSpeed)}` +
          (diagnostic.obstacleId
            ? ` gap:${Math.round(diagnostic.obstacleDistance)} ${shortId(diagnostic.obstacleId)}`
            : '') +
          (diagnostic.recoveryCount > 0 ? ` recover:${diagnostic.recoveryCount}` : '')
        : '';
      this.drawEntity(
        vehicle.x,
        vehicle.y,
        VEHICLE_RADIUS,
        vehicle.angle,
        0x9d8bff,
        `vehicle:${vehicleId}`,
        `${vehicleId} ${mode} hp:${vehicle.health}/${vehicle.maxHealth} ` +
          `eng:${vehicle.engineDamage} d:${damage} v:${Math.round(vehicle.speed)}${status}${traffic}`,
        present,
        vehicle.health > 0
      );
    });
  }

  private drawBullets(): void {
    this.state?.bullets?.forEach((bullet) => {
      this.graphics.lineStyle(1, bullet.ownerKind === 'police' ? 0xff5e68 : 0xffffff, 1);
      this.graphics.strokeCircle(bullet.x, bullet.y, 6);
      this.graphics.lineBetween(
        bullet.x,
        bullet.y,
        bullet.x + Math.cos(bullet.angle) * 14,
        bullet.y + Math.sin(bullet.angle) * 14
      );
    });
  }

  private drawStimuli(present: Set<string>): void {
    for (const stimulus of this.snapshot?.stimuli ?? []) {
      const color = stimulusColor(stimulus.kind);
      this.graphics.fillStyle(color, 0.025);
      this.graphics.fillCircle(stimulus.x, stimulus.y, stimulus.radius);
      this.graphics.lineStyle(1, color, 0.36);
      this.graphics.strokeCircle(stimulus.x, stimulus.y, stimulus.radius);
      this.graphics.lineStyle(2, color, 0.95);
      this.graphics.strokeCircle(stimulus.x, stimulus.y, 10);
      const remaining = Math.max(0, stimulus.expiresAt - (this.snapshot?.nowMs ?? 0));
      const key = `stimulus:${stimulus.id}`;
      this.updateLabel(
        key,
        stimulus.x,
        stimulus.y - 14,
        `${stimulus.kind} s:${stimulus.severity.toFixed(2)} r:${Math.round(stimulus.radius)} ` +
          `ttl:${(remaining / 1000).toFixed(1)}s`,
        color,
        0.95
      );
      present.add(key);
    }
  }

  private drawIncidents(present: Set<string>): void {
    for (const incident of this.snapshot?.incidents ?? []) {
      const color = incident.status === 'reported' ? 0x777777 : 0xff9d3f;
      this.graphics.lineStyle(2, color, 0.95);
      this.graphics.strokeCircle(incident.x, incident.y, 18);
      this.graphics.lineBetween(incident.x - 7, incident.y - 7, incident.x + 7, incident.y + 7);
      this.graphics.lineBetween(incident.x + 7, incident.y - 7, incident.x - 7, incident.y + 7);
      const key = `incident:${incident.id}`;
      this.updateLabel(
        key,
        incident.x,
        incident.y - 22,
        `${incident.id} ${incident.kind} ${incident.status}`,
        color,
        1
      );
      present.add(key);
    }
  }

  private drawPursuits(): void {
    for (const pursuit of this.snapshot?.pursuits ?? []) {
      const officer = this.state?.npcs?.get(pursuit.officerId);
      if (!officer) continue;
      const color = pursuit.mode === 'pursuit' ? 0xff5e68 : 0x51f0b2;
      this.graphics.lineStyle(2, color, pursuit.mode === 'pursuit' ? 0.9 : 0.65);
      this.graphics.lineBetween(officer.x, officer.y, pursuit.lastKnownX, pursuit.lastKnownY);
      this.graphics.strokeCircle(
        pursuit.lastKnownX,
        pursuit.lastKnownY,
        pursuit.mode === 'pursuit' ? 9 : 24
      );
    }
  }

  private drawEntity(
    x: number,
    y: number,
    radius: number,
    angle: number,
    color: number,
    key: string,
    text: string,
    present: Set<string>,
    active: boolean
  ): void {
    const alpha = active ? 0.95 : 0.38;
    this.graphics.fillStyle(color, active ? 0.08 : 0.03);
    this.graphics.fillCircle(x, y, radius);
    this.graphics.lineStyle(1, color, alpha);
    this.graphics.strokeCircle(x, y, radius);
    this.graphics.lineBetween(
      x,
      y,
      x + Math.cos(angle) * (radius + 9),
      y + Math.sin(angle) * (radius + 9)
    );
    this.updateLabel(key, x, y - radius - 4, text, color, alpha);
    present.add(key);
  }

  private updateLabel(
    key: string,
    x: number,
    y: number,
    text: string,
    color: number,
    alpha: number
  ): void {
    let label = this.labels.get(key);
    if (!label) {
      label = this.scene.add.text(x, y, text, {
        color: colorString(color),
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '8px'
      }).setOrigin(0.5, 1).setDepth(990_000).setPadding(2, 1, 2, 1);
      this.labels.set(key, label);
    }
    label.setPosition(x, y).setText(text).setVisible(true).setAlpha(alpha);
  }

  private updatePanel(): void {
    const projection = projectDebugPanel(this.state, this.snapshot);
    for (const [field, element] of Object.entries(this.fields)) {
      if (element) element.textContent = String(projection[field as keyof typeof projection]);
    }
    if (!this.eventList) return;
    this.eventList.replaceChildren(...projection.events.map((text) => {
      const item = this.root.createElement('li');
      item.textContent = text;
      return item;
    }));
  }

  private readonly handleToggle = (event: Event): void => {
    event.stopPropagation();
    this.setVisible(!this.visible);
  };
}

function shortId(id: string): string {
  return id.length <= 6 ? id : id.slice(0, 6);
}

function colorString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function stimulusColor(kind: string): number {
  if (kind === 'gunshot') return 0xffd24a;
  if (kind === 'impact') return 0x8fdcff;
  if (kind === 'injury' || kind === 'death') return 0xff6b6b;
  if (kind === 'fire' || kind === 'explosion') return 0xff8f3f;
  return 0xffffff;
}

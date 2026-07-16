import {WORLD_COLLISION_REVISION} from '../../../shared/simulation/world-collision-revision.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {AudioEventController} from '../audio/audio-event-controller.ts';
import type {ActorBurnController} from '../combat/actor-burn-controller.ts';
import type {CombatHitboxHistory} from '../combat/combat-hitbox-history.ts';
import type {CombatReactionController} from '../combat/combat-reaction-controller.ts';
import type {ExplosionController} from '../combat/explosion-controller.ts';
import type {FireZoneController} from '../combat/fire-zone-controller.ts';
import type {MeleeCombatController} from '../combat/melee-combat-controller.ts';
import type {ProjectileController} from '../combat/projectile-controller.ts';
import type {RocketProjectileController} from '../combat/rocket-projectile-controller.ts';
import type {ThrownProjectileController} from '../combat/thrown-projectile-controller.ts';
import type {DebugSnapshotController} from '../debug/debug-snapshot-controller.ts';
import type {GameEvent, GameEventStream} from '../events/game-events.ts';
import type {InteractionSnapshotProjector} from '../network/interaction-snapshot-projector.ts';
import type {PedestrianController} from '../pedestrians/pedestrian-controller.ts';
import type {CashPickupController} from '../pickups/cash-pickup-controller.ts';
import type {WeaponPickupController} from '../pickups/weapon-pickup-controller.ts';
import type {PlayerControlController} from '../players/player-control-controller.ts';
import type {PlayerLifecycleController} from '../players/player-lifecycle-controller.ts';
import type {CrimeResponseController} from '../police/crime-response-controller.ts';
import type {PoliceResponseFleetController} from '../police/police-response-fleet-controller.ts';
import {populationInterestAnchorsForPlayers} from '../population/population-interest-anchor-policy.ts';
import type {PopulationStreamingController} from '../population/population-streaming-controller.ts';
import type {TrafficSignalController} from '../traffic/traffic-signal-controller.ts';
import type {VehicleAccessController} from '../vehicles/vehicle-access-controller.ts';
import type {VehicleSimulationController} from '../vehicles/vehicle-simulation-controller.ts';
import type {DeferredCommandQueue} from './deferred-command-queue.ts';
import {FixedStepClock, type SimulationFrame} from './fixed-step-clock.ts';
import type {WorldStimulusAdapter} from './world-stimulus-adapter.ts';
import type {WorldStimulusRegistry} from './world-stimulus-registry.ts';
import {
  SimulationPhasePipeline,
  type SimulationPhaseDefinition,
  type SimulationPhaseDiagnostic
} from './simulation-phase-pipeline.ts';

export const DISTRICT_SIMULATION_PHASES = Object.freeze([
  'frame-state',
  'simulation-activation',
  'environment',
  'vehicle-motion',
  'player-motion',
  'crime-response',
  'pedestrian-motion',
  'dynamic-contacts',
  'history-capture',
  'projectiles',
  'world-effects',
  'pickups',
  'incidents-missions',
  'lifecycle',
  'event-dispatch',
  'snapshot-observability'
] as const);

export type DistrictSimulationPhaseId = typeof DISTRICT_SIMULATION_PHASES[number];

interface DistrictSimulationContext extends SimulationFrame {
  events: GameEvent[];
}

interface MissionPort {
  update(nowMs: number): void;
  observeEvents(events: readonly GameEvent[]): void;
}

export interface DistrictSimulationOptions {
  state: DistrictState;
  clock: FixedStepClock;
  populationStreaming: PopulationStreamingController;
  trafficSignals: TrafficSignalController;
  explosions: ExplosionController;
  policeFleet: PoliceResponseFleetController;
  vehicles: VehicleSimulationController;
  reactions: CombatReactionController;
  melee: MeleeCombatController;
  playerLifecycle: PlayerLifecycleController;
  playerControl: PlayerControlController;
  vehicleAccess: VehicleAccessController;
  crime: CrimeResponseController;
  pedestrians: PedestrianController;
  worldStimuli: WorldStimulusRegistry;
  worldStimulusAdapter: WorldStimulusAdapter;
  combatHistory: CombatHitboxHistory;
  bullets: ProjectileController;
  rockets: RocketProjectileController;
  thrownProjectiles: ThrownProjectileController;
  fireZones: FireZoneController;
  actorBurn: ActorBurnController;
  weaponPickups: WeaponPickupController;
  cashPickups: CashPickupController;
  missions: MissionPort;
  lifecycle: DeferredCommandQueue;
  events: GameEventStream;
  audio: AudioEventController;
  interactionSnapshots: InteractionSnapshotProjector;
  interactionSnapshotsEnabled: () => boolean;
  debug: DebugSnapshotController;
  indexPlayer: (player: PlayerState) => void;
  indexNpc: (npc: NpcState) => void;
  indexVehicle: (vehicle: VehicleState) => void;
}

export class DistrictSimulation {
  private readonly pipeline: SimulationPhasePipeline<DistrictSimulationContext>;

  constructor(private readonly options: DistrictSimulationOptions) {
    this.pipeline = new SimulationPhasePipeline(this.createPhases());
  }

  advance(elapsedMs: number): number {
    return this.options.clock.advance(elapsedMs, (frame) => {
      this.pipeline.run({...frame, events: []});
    });
  }

  diagnostics(): SimulationPhaseDiagnostic[] {
    return this.pipeline.diagnostics();
  }

  private createPhases(): ReadonlyArray<SimulationPhaseDefinition<DistrictSimulationContext>> {
    const phase = (
      id: DistrictSimulationPhaseId,
      run: (context: DistrictSimulationContext) => void
    ): SimulationPhaseDefinition<DistrictSimulationContext> => ({id, run});
    return [
      phase('frame-state', ({tick, nowMs}) => {
        this.options.state.serverTick = tick;
        this.options.state.serverTimeMs = nowMs;
      }),
      phase('simulation-activation', ({nowMs}) => {
        this.options.populationStreaming.update(
          populationInterestAnchorsForPlayers(
            [...this.options.state.players.values()]
              .filter((player) => player.spaceId === 'street'),
            (vehicleId) => this.options.state.vehicles.get(vehicleId)
          ),
          nowMs
        );
      }),
      phase('environment', ({nowMs}) => {
        this.options.trafficSignals.beginTick();
        this.options.trafficSignals.update(nowMs);
        this.options.explosions.update(nowMs);
        this.options.policeFleet.update(nowMs);
      }),
      phase('vehicle-motion', ({deltaSeconds, nowMs}) => {
        this.options.vehicles.beginTick(nowMs);
        this.options.state.vehicles.forEach((vehicle) => {
          this.options.vehicles.update(vehicle, deltaSeconds, nowMs);
          this.options.indexVehicle(vehicle);
        });
        for (const vehicle of this.options.vehicles.finishTick(nowMs)) {
          this.options.indexVehicle(vehicle);
        }
      }),
      phase('player-motion', ({deltaSeconds, nowMs}) => {
        this.options.reactions.update(nowMs);
        this.options.melee.update(nowMs);
        this.options.state.players.forEach((player) => {
          if (!player.alive) {
            this.options.playerLifecycle.tryRespawn(player, nowMs);
          } else if (player.action) {
            this.options.playerLifecycle.updateProtection(player, nowMs);
            if (player.action === 'melee') {
              this.options.playerControl.updateOnFoot(player, deltaSeconds);
            } else {
              this.options.vehicleAccess.updateAction(player, nowMs);
            }
          } else {
            this.options.playerLifecycle.updateProtection(player, nowMs);
            this.options.playerControl.updateOnFoot(player, deltaSeconds);
            this.options.crime.decay(player, nowMs);
          }
          this.options.indexPlayer(player);
        });
      }),
      phase('crime-response', ({nowMs}) => {
        this.options.crime.processReports(nowMs);
        this.options.crime.updateResponse(nowMs);
      }),
      phase('pedestrian-motion', ({deltaSeconds, nowMs}) => {
        this.options.worldStimuli.expire(nowMs);
        this.options.state.npcs.forEach((npc) => {
          this.options.pedestrians.update(npc, deltaSeconds, nowMs);
          this.options.indexNpc(npc);
        });
      }),
      phase('dynamic-contacts', ({deltaSeconds, nowMs}) => {
        const contacts = this.options.vehicles.finishHumanoidContacts(deltaSeconds, nowMs);
        for (const vehicle of contacts.vehicles) this.options.indexVehicle(vehicle);
        for (const player of contacts.players) this.options.indexPlayer(player);
        for (const npc of contacts.npcs) this.options.indexNpc(npc);
      }),
      phase('history-capture', ({tick, nowMs}) => {
        this.options.combatHistory.capture({
          serverTick: tick,
          serverTimeMs: nowMs,
          worldCollisionRevision: WORLD_COLLISION_REVISION,
          players: this.options.state.players.values(),
          npcs: this.options.state.npcs.values(),
          vehicles: this.options.state.vehicles.values()
        });
      }),
      phase('projectiles', ({deltaSeconds, nowMs}) => {
        this.options.state.bullets.forEach((bullet, bulletId) => {
          this.options.bullets.update(bullet, bulletId, deltaSeconds, nowMs);
        });
        this.options.state.rockets.forEach((rocket, rocketId) => {
          this.options.rockets.update(rocket, rocketId, deltaSeconds, nowMs);
        });
        this.options.state.thrownProjectiles.forEach((projectile, projectileId) => {
          this.options.thrownProjectiles.update(projectile, projectileId, deltaSeconds, nowMs);
        });
      }),
      phase('world-effects', ({nowMs}) => {
        this.options.fireZones.update(nowMs);
        this.options.actorBurn.update(nowMs);
      }),
      phase('pickups', ({nowMs}) => {
        this.options.weaponPickups.update(nowMs);
        this.options.cashPickups.update(nowMs);
      }),
      phase('incidents-missions', ({nowMs}) => {
        this.options.crime.expire(nowMs);
        this.options.missions.update(nowMs);
      }),
      phase('lifecycle', () => {
        this.options.lifecycle.flush();
      }),
      phase('event-dispatch', (context) => {
        context.events = this.options.events.drain();
        this.options.explosions.observeEvents(context.events);
        this.options.missions.observeEvents(context.events);
        this.options.worldStimulusAdapter.ingest(context.events);
        this.options.cashPickups.observeEvents(context.events);
        this.options.audio.publish(context.events);
      }),
      phase('snapshot-observability', ({events}) => {
        if (this.options.interactionSnapshotsEnabled()) {
          this.options.interactionSnapshots.capture();
        }
        this.options.debug.update(events);
      })
    ];
  }
}

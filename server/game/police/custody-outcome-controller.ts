import {ON_FOOT_PLAYER_RADIUS} from '../../../shared/simulation/on-foot-step.ts';
import type {PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {StreetEconomyPort} from '../economy/street-economy-controller.ts';
import {hash32} from '../world/deterministic-random.ts';
import {custodyFineForWanted} from './police-force-policy.ts';

export interface CustodyOutcome {
  x: number;
  y: number;
  spaceId: 'street';
  angle: number;
  fine: number;
}

export interface CustodyOutcomePort {
  resolve(
    player: PlayerState,
    arrestId: string,
    wantedLevel: number,
    nowMs: number
  ): CustodyOutcome;
}

interface CustodyOutcomeControllerOptions {
  world: CollisionMap;
  economy: StreetEconomyPort;
  notice: (playerId: string, message: string, tone: 'success' | 'warning' | 'info') => void;
}

/**
 * Resolves the economic and release-location outcome of custody. This controller
 * deliberately does not mutate combat, wanted, inventory or player lifecycle state.
 */
export class CustodyOutcomeController implements CustodyOutcomePort {
  constructor(private readonly options: CustodyOutcomeControllerOptions) {}

  resolve(
    player: PlayerState,
    arrestId: string,
    wantedLevel: number,
    nowMs: number
  ): CustodyOutcome {
    const requestedFine = custodyFineForWanted(wantedLevel);
    const fine = Math.min(Math.max(0, Math.floor(player.cash)), requestedFine);
    if (fine > 0) {
      this.options.economy.debit(
        player.id,
        fine,
        'custody',
        `custody:${arrestId}`,
        nowMs
      );
    }
    const release = this.options.world.openPointNear(
      this.options.world.spawn.x,
      this.options.world.spawn.y,
      0,
      72,
      ON_FOOT_PLAYER_RADIUS,
      hash32(arrestId),
      true
    );
    this.options.notice(
      player.id,
      fine > 0 ? `Busted. Custody fee: $${fine}.` : 'Busted. No cash was seized.',
      'warning'
    );
    return {
      x: release.x,
      y: release.y,
      spaceId: 'street',
      angle: -Math.PI / 2,
      fine
    };
  }
}

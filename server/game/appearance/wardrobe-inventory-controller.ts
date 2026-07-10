import type {PlayerAppearance} from '../../../shared/content/appearance-catalog.ts';
import {
  BASE_WARDROBE_GRANTS,
  DEVELOPMENT_WARDROBE_GRANTS,
  isWardrobeItemId,
  requiredWardrobeItems,
  type WardrobeItemId
} from '../../../shared/content/wardrobe-catalog.ts';
import type {WardrobeStateMessage} from '../../../shared/protocol/wardrobe.ts';

export class WardrobeInventoryController {
  private readonly inventories = new Map<string, Set<WardrobeItemId>>();

  initialize(
    playerId: string,
    grants: readonly WardrobeItemId[] = DEVELOPMENT_WARDROBE_GRANTS
  ): void {
    const owned = new Set<WardrobeItemId>(BASE_WARDROBE_GRANTS);
    for (const itemId of grants) {
      if (isWardrobeItemId(itemId)) owned.add(itemId);
    }
    this.inventories.set(playerId, owned);
  }

  canEquip(playerId: string, appearance: PlayerAppearance): boolean {
    return this.missingItems(playerId, appearance).length === 0;
  }

  missingItems(playerId: string, appearance: PlayerAppearance): WardrobeItemId[] {
    const owned = this.inventories.get(playerId);
    return requiredWardrobeItems(appearance).filter((itemId) => !owned?.has(itemId));
  }

  grant(playerId: string, itemId: WardrobeItemId): boolean {
    const owned = this.inventories.get(playerId);
    if (!owned || !isWardrobeItemId(itemId)) return false;
    const previousSize = owned.size;
    owned.add(itemId);
    return owned.size !== previousSize;
  }

  owns(playerId: string, itemId: WardrobeItemId): boolean {
    return this.inventories.get(playerId)?.has(itemId) ?? false;
  }

  snapshot(playerId: string): WardrobeStateMessage {
    const owned = this.inventories.get(playerId);
    return {
      ownedItemIds: DEVELOPMENT_WARDROBE_GRANTS.filter((itemId) => owned?.has(itemId)),
      developmentGrants: Boolean(
        owned && DEVELOPMENT_WARDROBE_GRANTS.every((itemId) => owned.has(itemId))
      )
    };
  }

  clearPlayer(playerId: string): void {
    this.inventories.delete(playerId);
  }
}

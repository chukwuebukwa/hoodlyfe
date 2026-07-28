export type GameWorldId = 'industrial-district' | 'raceway' | 'deathmatch';

export interface GameWorldDefinition {
  id: GameWorldId;
  roomName: string;
  assetRoot: string;
  runtimeLabel: string;
  loadingTitle: string;
  enableInteriors: boolean;
}

const GAME_WORLDS: Record<GameWorldId, GameWorldDefinition> = {
  'industrial-district': {
    id: 'industrial-district',
    roomName: 'district',
    assetRoot: '/assets',
    runtimeLabel: 'Industrial District',
    loadingTitle: 'HOODLYFE',
    enableInteriors: true
  },
  raceway: {
    id: 'raceway',
    roomName: 'district-race',
    assetRoot: '/assets/districts/raceway',
    runtimeLabel: 'Raceway',
    loadingTitle: 'RACEWAY',
    enableInteriors: false
  },
  deathmatch: {
    id: 'deathmatch',
    roomName: 'district-deathmatch',
    assetRoot: '/assets/districts/deathmatch',
    runtimeLabel: 'Foundry Yard',
    loadingTitle: 'DEATHMATCH',
    enableInteriors: false
  }
};

export function gameWorldDefinition(id: GameWorldId): GameWorldDefinition {
  return GAME_WORLDS[id];
}

export function gameWorldIdForRoom(roomName: string | undefined): GameWorldId | undefined {
  const resolvedRoomName = roomName ?? 'district';
  return (Object.values(GAME_WORLDS) as GameWorldDefinition[])
    .find((world) => world.roomName === resolvedRoomName)?.id;
}

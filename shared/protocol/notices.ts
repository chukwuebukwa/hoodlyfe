export const GAME_NOTICE_MESSAGE = 'game.notice';

export interface GameNotice {
  message: string;
  tone: 'info' | 'success' | 'warning';
}

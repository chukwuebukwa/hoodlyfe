export const ON_FOOT_INPUT_MESSAGE = 'on-foot.input';

export interface OnFootInputMoveMessage {
  sequence: number;
  x: number;
  y: number;
}

export interface OnFootInputBatchMessage {
  moves: OnFootInputMoveMessage[];
}

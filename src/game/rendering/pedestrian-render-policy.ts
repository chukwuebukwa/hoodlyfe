export interface PedestrianMotionPresentation {
  animate: boolean;
  timeScale: number;
  tint?: number;
  alpha: number;
}

export function pedestrianMotionPresentation(
  action: string,
  distance: number
): PedestrianMotionPresentation {
  if (action === 'dead') return {animate: false, timeScale: 1, alpha: 0};
  if (action === 'startle') {
    return {animate: false, timeScale: 1, tint: 0xffd6a0, alpha: 1};
  }
  if (action === 'recover') {
    return {animate: false, timeScale: 1, tint: 0xdce8e8, alpha: 0.94};
  }
  const animate = distance > 0.75;
  if (action === 'assault') return {animate, timeScale: 1.3, tint: 0xff7a66, alpha: 1};
  if (action === 'flee') return {animate, timeScale: 1.55, alpha: 1};
  if (action === 'pursue') return {animate, timeScale: 1.28, alpha: 1};
  if (action === 'investigate' || action === 'search') {
    return {animate, timeScale: 0.82, alpha: 1};
  }
  return {animate, timeScale: 1, alpha: 1};
}

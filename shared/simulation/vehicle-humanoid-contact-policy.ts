export const VEHICLE_HUMANOID_MASS = 0.08;
export const TRAFFIC_HUMANOID_IMPACT_THRESHOLD = 70;
export const DRIVER_HUMANOID_IMPACT_THRESHOLD = 90;
export const MINIMUM_INTERACTION_VEHICLE_SPEED = -150;
export const MAXIMUM_INTERACTION_VEHICLE_SPEED = 430;

export function vehicleHumanoidImpactThreshold(playerControlled: boolean): number {
  return playerControlled
    ? DRIVER_HUMANOID_IMPACT_THRESHOLD
    : TRAFFIC_HUMANOID_IMPACT_THRESHOLD;
}

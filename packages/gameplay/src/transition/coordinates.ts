/**
 * Coordinate Bridge - Converts between space and ground coordinate systems
 *
 * Space: 1 unit ≈ 50 meters (macroscopic, fighters move at 250+ u/s)
 * Ground: 1 unit = 1 meter (human scale, soldiers move at 5-7 m/s)
 */

export type Vec3 = { x: number; y: number; z: number };

/**
 * Ratio between space units and ground meters.
 * Space coordinates / RATIO = Ground coordinates
 */
export const SPACE_GROUND_RATIO = 50;

/**
 * Altitude threshold for landing/launch detection (in space units)
 */
export const LANDING_ALTITUDE_THRESHOLD = 500;

/**
 * Altitude at which transition completes (in space units)
 */
export const SURFACE_ALTITUDE = 50;

/**
 * Convert space coordinates to ground coordinates
 */
export function spaceToGround(spacePos: Vec3): Vec3 {
  return {
    x: spacePos.x / SPACE_GROUND_RATIO,
    y: Math.max(0, spacePos.y / SPACE_GROUND_RATIO), // Clamp Y to ground level
    z: spacePos.z / SPACE_GROUND_RATIO
  };
}

/**
 * Convert ground coordinates to space coordinates
 */
export function groundToSpace(groundPos: Vec3): Vec3 {
  return {
    x: groundPos.x * SPACE_GROUND_RATIO,
    y: groundPos.y * SPACE_GROUND_RATIO,
    z: groundPos.z * SPACE_GROUND_RATIO
  };
}

/**
 * Get altitude above planet surface (in space units)
 * Assumes planet surface is at Y=0 in the local system
 */
export function getAltitude(spaceY: number): number {
  return Math.max(0, spaceY);
}

/**
 * Check if position is within landing range
 */
export function isInLandingRange(spaceY: number): boolean {
  return getAltitude(spaceY) < LANDING_ALTITUDE_THRESHOLD;
}

/**
 * Check if position is at surface level (landed)
 */
export function isAtSurface(spaceY: number): boolean {
  return getAltitude(spaceY) < SURFACE_ALTITUDE;
}

/**
 * Calculate landing zone position on ground from space position
 */
export function calculateLandingZone(spacePos: Vec3): Vec3 {
  const groundPos = spaceToGround(spacePos);
  return {
    x: groundPos.x,
    y: 0, // Always land at ground level
    z: groundPos.z
  };
}

/**
 * Calculate launch position in space from ground position
 */
export function calculateLaunchPosition(groundPos: Vec3): Vec3 {
  const spacePos = groundToSpace(groundPos);
  return {
    x: spacePos.x,
    y: SURFACE_ALTITUDE + 10, // Start slightly above surface
    z: spacePos.z
  };
}

/**
 * Interpolate between space and ground during transition
 * @param progress 0 = space, 1 = ground
 */
export function interpolateTransition(
  spacePos: Vec3,
  groundPos: Vec3,
  progress: number
): Vec3 {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: spacePos.x + (groundPos.x - spacePos.x) * t,
    y: spacePos.y + (groundPos.y - spacePos.y) * t,
    z: spacePos.z + (groundPos.z - spacePos.z) * t
  };
}

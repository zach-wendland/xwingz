/**
 * Mock for @xwingz/physics package
 * Re-exports SpatialHash without the rapier-world dependency to avoid WASM loading issues in Jest
 */

export { SpatialHash } from '../../../packages/physics/src/SpatialHash';

// Mock rapier-world exports (not used in space combat systems)
export const PHYSICS_VERSION = 1;

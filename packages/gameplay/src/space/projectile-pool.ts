/**
 * ProjectilePool - Object pooling for projectile entities
 *
 * Reduces allocation overhead by reusing projectile entities instead of
 * creating and removing them each frame. Inactive projectiles are moved
 * off-screen and marked as "pooled".
 *
 * Performance improvement:
 * - Avoids entity creation/removal overhead in hot path
 * - Reduces GC pressure from rapid spawn/despawn cycles
 * - Pre-allocates common projectile count to avoid startup spikes
 */

import { IWorld, addEntity, addComponent, removeComponent, hasComponent, defineComponent, Types } from "bitecs";
import { Transform, Velocity, Projectile } from "./components";

// Marker component for pooled (inactive) entities
export const Pooled = defineComponent({
  originalType: Types.ui8 // 0=laser, 1=torpedo, etc.
});

// Pool constants
const POOL_OFFSCREEN_Y = -100000;
const INITIAL_POOL_SIZE = 64;
const MAX_POOL_SIZE = 512;

// Pools by projectile type
const laserPool: number[] = [];
const torpedoPool: number[] = [];

// Stats tracking
let totalAllocated = 0;
let poolHits = 0;
let poolMisses = 0;

/**
 * Initialize the projectile pool with pre-allocated entities.
 * Call this once during game initialization.
 */
export function initProjectilePool(world: IWorld): void {
  // Pre-allocate laser projectiles
  for (let i = 0; i < INITIAL_POOL_SIZE; i++) {
    const eid = createPooledProjectile(world, 0);
    laserPool.push(eid);
  }
  totalAllocated = INITIAL_POOL_SIZE;
}

/**
 * Create a new pooled projectile entity (inactive state)
 */
function createPooledProjectile(world: IWorld, type: number): number {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Projectile, eid);
  addComponent(world, Pooled, eid);

  // Move off-screen
  Transform.x[eid] = 0;
  Transform.y[eid] = POOL_OFFSCREEN_Y;
  Transform.z[eid] = 0;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;

  Projectile.life[eid] = 0;
  Projectile.owner[eid] = -1;
  Projectile.damage[eid] = 0;

  Pooled.originalType[eid] = type;

  return eid;
}

/**
 * Acquire a projectile from the pool (or create new if pool empty).
 * The projectile is activated and ready for use.
 */
export function acquireProjectile(world: IWorld, type: number = 0): number {
  const pool = type === 0 ? laserPool : torpedoPool;

  let eid: number;

  if (pool.length > 0) {
    // Reuse from pool
    eid = pool.pop()!;
    poolHits++;

    // Remove pooled marker
    if (hasComponent(world, Pooled, eid)) {
      removeComponent(world, Pooled, eid);
    }
  } else {
    // Create new if pool empty (and under limit)
    if (totalAllocated < MAX_POOL_SIZE) {
      eid = addEntity(world);
      addComponent(world, Transform, eid);
      addComponent(world, Velocity, eid);
      addComponent(world, Projectile, eid);
      totalAllocated++;
      poolMisses++;
    } else {
      // Pool exhausted and at max - create temporary (will be removed normally)
      eid = addEntity(world);
      addComponent(world, Transform, eid);
      addComponent(world, Velocity, eid);
      addComponent(world, Projectile, eid);
      poolMisses++;
    }
  }

  return eid;
}

/**
 * Release a projectile back to the pool.
 * Call this instead of removeEntity() for pooled projectiles.
 */
export function releaseProjectile(world: IWorld, eid: number, type: number = 0): void {
  const pool = type === 0 ? laserPool : torpedoPool;

  // Don't exceed max pool size
  if (pool.length >= MAX_POOL_SIZE) {
    // Pool full, let it be garbage collected
    return;
  }

  // Mark as pooled
  if (!hasComponent(world, Pooled, eid)) {
    addComponent(world, Pooled, eid);
  }

  // Reset state and move off-screen
  Transform.y[eid] = POOL_OFFSCREEN_Y;
  Velocity.vx[eid] = 0;
  Velocity.vy[eid] = 0;
  Velocity.vz[eid] = 0;
  Projectile.life[eid] = 0;
  Projectile.owner[eid] = -1;
  Projectile.damage[eid] = 0;
  Pooled.originalType[eid] = type;

  pool.push(eid);
}

/**
 * Check if an entity is currently pooled (inactive)
 */
export function isPooled(world: IWorld, eid: number): boolean {
  return hasComponent(world, Pooled, eid);
}

/**
 * Get pool statistics for debugging
 */
export function getPoolStats(): {
  laserPoolSize: number;
  torpedoPoolSize: number;
  totalAllocated: number;
  poolHits: number;
  poolMisses: number;
  hitRate: number;
} {
  const totalRequests = poolHits + poolMisses;
  return {
    laserPoolSize: laserPool.length,
    torpedoPoolSize: torpedoPool.length,
    totalAllocated,
    poolHits,
    poolMisses,
    hitRate: totalRequests > 0 ? poolHits / totalRequests : 1
  };
}

/**
 * Clear the pool (call on mode exit)
 */
export function clearProjectilePool(): void {
  laserPool.length = 0;
  torpedoPool.length = 0;
  totalAllocated = 0;
  poolHits = 0;
  poolMisses = 0;
}

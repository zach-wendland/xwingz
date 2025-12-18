/**
 * SpaceCombatSpatialIndex - Unified spatial indexing for space combat
 *
 * Consolidates duplicate spatial hashes from systems.ts and capital-systems.ts
 * into a single, shared index rebuilt once per frame.
 *
 * Previously:
 * - systems.ts: targetSpatialHash (cell=100) for projectile collision
 * - capital-systems.ts: fighterSpatialHash (cell=150) for turret targeting
 *
 * Both indexed [Health, HitRadius, Transform] entities - the same set!
 * This unified index eliminates the duplicate rebuild cost.
 */

import { IWorld, defineQuery, hasComponent } from "bitecs";
import { SpatialHash } from "@xwingz/physics";
import { Health, HitRadius, Transform, Team, AIControlled } from "./components";

// Query for all combat-relevant entities (fighters, capital ships, subsystems)
const combatEntityQuery = defineQuery([Health, HitRadius, Transform]);

// Query for AI-controlled entities (for separation system optimization)
const aiEntityQuery = defineQuery([AIControlled, Transform]);

/**
 * Unified spatial index for space combat.
 *
 * Cell size 120 balances:
 * - Projectile collision (typical radius 30-35)
 * - Turret targeting (typical range 200-400)
 * - AI separation queries (radius 90)
 *
 * Optimal cell size is ~2-3x the most common query radius.
 */
class SpaceCombatSpatialIndex {
  // Main index for all combat entities (projectiles, turrets, AI)
  private combatHash: SpatialHash;

  // Separate index for AI entities only (for separation system)
  private aiHash: SpatialHash;

  // Track if rebuilt this frame
  private frameRebuilt = false;

  constructor() {
    // Cell size 120 is a balanced choice between:
    // - Old systems.ts cell size 100
    // - Old capital-systems.ts cell size 150
    this.combatHash = new SpatialHash(120);
    this.aiHash = new SpatialHash(100); // Smaller cells for tighter AI separation
  }

  /**
   * Rebuild all spatial indices. Call once per frame before any queries.
   * Single pass inserts into both hashes.
   */
  rebuild(world: IWorld): void {
    this.combatHash.clear();
    this.aiHash.clear();

    // Single pass over combat entities
    const combatEntities = combatEntityQuery(world);
    for (const eid of combatEntities) {
      const x = Transform.x[eid] ?? 0;
      const y = Transform.y[eid] ?? 0;
      const z = Transform.z[eid] ?? 0;

      // Insert into main combat hash
      this.combatHash.insert(eid, x, y, z);

      // Also insert AI entities into AI-specific hash
      if (hasComponent(world, AIControlled, eid)) {
        this.aiHash.insert(eid, x, y, z);
      }
    }

    this.frameRebuilt = true;
  }

  /**
   * Query nearby combat entities (projectile collision, turret targeting).
   * Replaces both targetSpatialHash.query() and fighterSpatialHash.query().
   */
  queryCombatants(x: number, y: number, z: number, radius: number): number[] {
    return this.combatHash.query(x, y, z, radius);
  }

  /**
   * Query nearby AI entities only (for separation system).
   * More efficient than queryCombatants + filter for AI separation.
   */
  queryAIEntities(x: number, y: number, z: number, radius: number): number[] {
    return this.aiHash.query(x, y, z, radius);
  }

  /**
   * Filter query results by team (enemy filter for targeting).
   */
  queryEnemies(
    world: IWorld,
    x: number,
    y: number,
    z: number,
    radius: number,
    myTeam: number
  ): number[] {
    const nearby = this.combatHash.query(x, y, z, radius);
    return nearby.filter((eid) => {
      const theirTeam = Team.id[eid] ?? -1;
      return theirTeam !== myTeam && theirTeam >= 0;
    });
  }

  /**
   * Get debug stats for profiling.
   */
  getStats(): { combatCells: number; combatEntities: number; aiCells: number; aiEntities: number } {
    return {
      combatCells: this.combatHash.cellCount,
      combatEntities: this.combatHash.entityCount,
      aiCells: this.aiHash.cellCount,
      aiEntities: this.aiHash.entityCount,
    };
  }

  /**
   * Check if index was rebuilt this frame (for debugging).
   */
  wasRebuiltThisFrame(): boolean {
    return this.frameRebuilt;
  }

  /**
   * Mark frame as processed (call at end of frame).
   */
  endFrame(): void {
    this.frameRebuilt = false;
  }
}

// Singleton instance - shared across all space combat systems
export const spaceCombatIndex = new SpaceCombatSpatialIndex();

/**
 * Rebuild the unified spatial index. Call once per frame.
 * Replaces: rebuildTargetSpatialHash() + rebuildFighterSpatialHash()
 */
export function rebuildSpaceCombatIndex(world: IWorld): void {
  spaceCombatIndex.rebuild(world);
}

// Legacy exports for gradual migration
// These will be removed after full migration

/**
 * @deprecated Use spaceCombatIndex.queryCombatants() instead
 */
export function rebuildTargetSpatialHash(world: IWorld): void {
  // Only rebuild if not already done this frame
  if (!spaceCombatIndex.wasRebuiltThisFrame()) {
    spaceCombatIndex.rebuild(world);
  }
}

/**
 * @deprecated Use spaceCombatIndex.queryCombatants() instead
 */
export function rebuildFighterSpatialHash(world: IWorld): void {
  // Only rebuild if not already done this frame
  if (!spaceCombatIndex.wasRebuiltThisFrame()) {
    spaceCombatIndex.rebuild(world);
  }
}

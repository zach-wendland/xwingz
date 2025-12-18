/**
 * Unit tests for SpaceCombatSpatialIndex - unified spatial indexing
 *
 * Tests the consolidated spatial hash that replaced duplicate hashes
 * from systems.ts and capital-systems.ts.
 */

import { createWorld, addEntity, addComponent, IWorld } from "bitecs";
import {
  Transform,
  Health,
  HitRadius,
  Team,
  AIControlled,
} from "../../../packages/gameplay/src/space/components";

// Import the module to test
import {
  spaceCombatIndex,
  rebuildSpaceCombatIndex,
  rebuildTargetSpatialHash,
  rebuildFighterSpatialHash,
} from "../../../packages/gameplay/src/space/spatial-index";

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createCombatEntity(
  world: IWorld,
  options: {
    x?: number;
    y?: number;
    z?: number;
    team?: number;
    hp?: number;
    radius?: number;
    isAI?: boolean;
  } = {}
): number {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, Health, eid);
  addComponent(world, HitRadius, eid);
  addComponent(world, Team, eid);

  Transform.x[eid] = options.x ?? 0;
  Transform.y[eid] = options.y ?? 0;
  Transform.z[eid] = options.z ?? 0;
  Transform.qx[eid] = 0;
  Transform.qy[eid] = 0;
  Transform.qz[eid] = 0;
  Transform.qw[eid] = 1;

  Health.hp[eid] = options.hp ?? 100;
  Health.maxHp[eid] = options.hp ?? 100;
  HitRadius.r[eid] = options.radius ?? 10;
  Team.id[eid] = options.team ?? 0;

  if (options.isAI) {
    addComponent(world, AIControlled, eid);
  }

  return eid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("SpaceCombatSpatialIndex", () => {
  describe("rebuild", () => {
    it("should rebuild index with combat entities", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 0, y: 0, z: 0 });
      createCombatEntity(world, { x: 100, y: 0, z: 0 });
      createCombatEntity(world, { x: 200, y: 0, z: 0 });

      rebuildSpaceCombatIndex(world);

      const stats = spaceCombatIndex.getStats();
      expect(stats.combatEntities).toBe(3);
    });

    it("should track AI entities separately", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 0, y: 0, z: 0, isAI: true });
      createCombatEntity(world, { x: 100, y: 0, z: 0, isAI: true });
      createCombatEntity(world, { x: 200, y: 0, z: 0, isAI: false });

      rebuildSpaceCombatIndex(world);

      const stats = spaceCombatIndex.getStats();
      expect(stats.combatEntities).toBe(3);
      expect(stats.aiEntities).toBe(2);
    });

    it("should clear previous frame data on rebuild", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 0, y: 0, z: 0 });
      rebuildSpaceCombatIndex(world);

      // Create new world with different entities
      const world2 = createWorld();
      createCombatEntity(world2, { x: 500, y: 500, z: 500 });
      rebuildSpaceCombatIndex(world2);

      // Old entity at origin should not be found
      const nearby = spaceCombatIndex.queryCombatants(0, 0, 0, 50);
      expect(nearby.length).toBe(0);

      // New entity at 500,500,500 should be found
      const nearbyNew = spaceCombatIndex.queryCombatants(500, 500, 500, 50);
      expect(nearbyNew.length).toBe(1);
    });

    it("should set frameRebuilt flag", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 0, y: 0, z: 0 });

      spaceCombatIndex.endFrame(); // Reset flag
      expect(spaceCombatIndex.wasRebuiltThisFrame()).toBe(false);

      rebuildSpaceCombatIndex(world);
      expect(spaceCombatIndex.wasRebuiltThisFrame()).toBe(true);
    });
  });

  describe("queryCombatants", () => {
    it("should find entities within radius", () => {
      const world = createWorld();
      const eid1 = createCombatEntity(world, { x: 0, y: 0, z: 0 });
      const eid2 = createCombatEntity(world, { x: 50, y: 0, z: 0 });
      createCombatEntity(world, { x: 500, y: 0, z: 0 }); // Far away

      rebuildSpaceCombatIndex(world);

      const nearby = spaceCombatIndex.queryCombatants(25, 0, 0, 100);
      expect(nearby).toContain(eid1);
      expect(nearby).toContain(eid2);
      expect(nearby.length).toBe(2);
    });

    it("should return empty array when no entities nearby", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 1000, y: 1000, z: 1000 });

      rebuildSpaceCombatIndex(world);

      const nearby = spaceCombatIndex.queryCombatants(0, 0, 0, 50);
      expect(nearby).toHaveLength(0);
    });

    it("should handle 3D queries correctly", () => {
      const world = createWorld();
      const eid1 = createCombatEntity(world, { x: 0, y: 0, z: 0 });
      createCombatEntity(world, { x: 0, y: 300, z: 0 }); // Far in Y
      createCombatEntity(world, { x: 0, y: 0, z: 300 }); // Far in Z

      rebuildSpaceCombatIndex(world);

      const nearby = spaceCombatIndex.queryCombatants(0, 0, 0, 50);
      expect(nearby).toContain(eid1);
      expect(nearby.length).toBe(1);
    });

    it("should handle negative coordinates", () => {
      const world = createWorld();
      const eid = createCombatEntity(world, { x: -100, y: -50, z: -200 });

      rebuildSpaceCombatIndex(world);

      const nearby = spaceCombatIndex.queryCombatants(-100, -50, -200, 50);
      expect(nearby).toContain(eid);
    });
  });

  describe("queryAIEntities", () => {
    it("should only return AI-controlled entities", () => {
      const world = createWorld();
      const ai1 = createCombatEntity(world, { x: 0, y: 0, z: 0, isAI: true });
      const ai2 = createCombatEntity(world, { x: 50, y: 0, z: 0, isAI: true });
      createCombatEntity(world, { x: 25, y: 0, z: 0, isAI: false }); // Not AI

      rebuildSpaceCombatIndex(world);

      const nearby = spaceCombatIndex.queryAIEntities(25, 0, 0, 100);
      expect(nearby).toContain(ai1);
      expect(nearby).toContain(ai2);
      expect(nearby.length).toBe(2);
    });

    it("should return empty for non-AI entities", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 0, y: 0, z: 0, isAI: false });
      createCombatEntity(world, { x: 50, y: 0, z: 0, isAI: false });

      rebuildSpaceCombatIndex(world);

      const nearby = spaceCombatIndex.queryAIEntities(25, 0, 0, 100);
      expect(nearby).toHaveLength(0);
    });
  });

  describe("queryEnemies", () => {
    it("should filter out friendly entities", () => {
      const world = createWorld();
      const enemy = createCombatEntity(world, { x: 0, y: 0, z: 0, team: 1 });
      createCombatEntity(world, { x: 50, y: 0, z: 0, team: 0 }); // Friendly

      rebuildSpaceCombatIndex(world);

      const enemies = spaceCombatIndex.queryEnemies(world, 25, 0, 0, 100, 0);
      expect(enemies).toContain(enemy);
      expect(enemies.length).toBe(1);
    });

    it("should return multiple enemies", () => {
      const world = createWorld();
      const enemy1 = createCombatEntity(world, { x: 0, y: 0, z: 0, team: 1 });
      const enemy2 = createCombatEntity(world, { x: 50, y: 0, z: 0, team: 2 });
      createCombatEntity(world, { x: 25, y: 0, z: 0, team: 0 }); // Friendly

      rebuildSpaceCombatIndex(world);

      const enemies = spaceCombatIndex.queryEnemies(world, 25, 0, 0, 100, 0);
      expect(enemies).toContain(enemy1);
      expect(enemies).toContain(enemy2);
      expect(enemies.length).toBe(2);
    });

    it("should handle team -1 as invalid", () => {
      const world = createWorld();
      const invalidTeam = createCombatEntity(world, { x: 0, y: 0, z: 0, team: -1 });

      rebuildSpaceCombatIndex(world);

      const enemies = spaceCombatIndex.queryEnemies(world, 0, 0, 0, 100, 0);
      expect(enemies).not.toContain(invalidTeam);
    });
  });

  describe("legacy exports", () => {
    it("rebuildTargetSpatialHash should always rebuild for backwards compatibility", () => {
      const world = createWorld();
      const eid = createCombatEntity(world, { x: 0, y: 0, z: 0 });

      rebuildTargetSpatialHash(world);
      expect(spaceCombatIndex.wasRebuiltThisFrame()).toBe(true);
      expect(spaceCombatIndex.getStats().combatEntities).toBe(1);

      // Create a second entity and rebuild - should include new entity
      createCombatEntity(world, { x: 100, y: 0, z: 0 });
      rebuildTargetSpatialHash(world);
      expect(spaceCombatIndex.getStats().combatEntities).toBe(2);
    });

    it("rebuildFighterSpatialHash should use unified index", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 0, y: 0, z: 0 });

      rebuildFighterSpatialHash(world);

      expect(spaceCombatIndex.wasRebuiltThisFrame()).toBe(true);
      expect(spaceCombatIndex.getStats().combatEntities).toBe(1);
    });

    it("legacy exports should work correctly in tests", () => {
      // This test verifies that legacy exports work in test isolation
      const world = createWorld();
      const target = createCombatEntity(world, { x: 50, y: 0, z: 0 });

      rebuildTargetSpatialHash(world);

      const nearby = spaceCombatIndex.queryCombatants(50, 0, 0, 30);
      expect(nearby).toContain(target);
    });
  });

  describe("getStats", () => {
    it("should return correct cell and entity counts", () => {
      const world = createWorld();
      // Create entities far enough apart to be in different cells
      createCombatEntity(world, { x: 0, y: 0, z: 0, isAI: true });
      createCombatEntity(world, { x: 200, y: 0, z: 0, isAI: true });
      createCombatEntity(world, { x: 400, y: 0, z: 0, isAI: false });

      rebuildSpaceCombatIndex(world);

      const stats = spaceCombatIndex.getStats();
      expect(stats.combatEntities).toBe(3);
      expect(stats.aiEntities).toBe(2);
      expect(stats.combatCells).toBeGreaterThan(0);
      expect(stats.aiCells).toBeGreaterThan(0);
    });
  });

  describe("endFrame", () => {
    it("should reset frameRebuilt flag", () => {
      const world = createWorld();
      createCombatEntity(world, { x: 0, y: 0, z: 0 });
      rebuildSpaceCombatIndex(world);

      expect(spaceCombatIndex.wasRebuiltThisFrame()).toBe(true);

      spaceCombatIndex.endFrame();

      expect(spaceCombatIndex.wasRebuiltThisFrame()).toBe(false);
    });
  });

  describe("performance characteristics", () => {
    it("should handle many entities efficiently", () => {
      const world = createWorld();

      // Create 100 entities in a grid
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100;
        const z = Math.floor(i / 10) * 100;
        createCombatEntity(world, { x, y: 0, z, isAI: i % 2 === 0 });
      }

      rebuildSpaceCombatIndex(world);

      const stats = spaceCombatIndex.getStats();
      expect(stats.combatEntities).toBe(100);
      expect(stats.aiEntities).toBe(50);

      // Query should return subset, not all entities
      const nearby = spaceCombatIndex.queryCombatants(50, 0, 50, 80);
      expect(nearby.length).toBeLessThan(100);
      expect(nearby.length).toBeGreaterThan(0);
    });

    it("should rebuild efficiently per frame", () => {
      const world = createWorld();

      for (let i = 0; i < 50; i++) {
        createCombatEntity(world, { x: i * 50, y: 0, z: 0 });
      }

      // Simulate multiple frame rebuilds
      for (let frame = 0; frame < 10; frame++) {
        spaceCombatIndex.endFrame();
        rebuildSpaceCombatIndex(world);
        expect(spaceCombatIndex.getStats().combatEntities).toBe(50);
      }
    });
  });
});

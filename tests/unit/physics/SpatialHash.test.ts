/**
 * Unit tests for SpatialHash - 3D spatial indexing for efficient collision queries
 */

// Import directly to avoid Rapier WASM dependency in Jest
import { SpatialHash } from "../../../packages/physics/src/SpatialHash";

describe("SpatialHash", () => {
  describe("basic operations", () => {
    it("should create with default cell size", () => {
      const hash = new SpatialHash();
      expect(hash.cellCount).toBe(0);
      expect(hash.entityCount).toBe(0);
    });

    it("should create with custom cell size", () => {
      const hash = new SpatialHash(50);
      expect(hash.cellCount).toBe(0);
    });

    it("should insert entities", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 50, 50, 50);
      expect(hash.entityCount).toBe(2);
    });

    it("should clear all entities", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 100, 100, 100);
      hash.clear();
      expect(hash.entityCount).toBe(0);
      expect(hash.cellCount).toBe(0);
    });
  });

  describe("cell distribution", () => {
    it("should place nearby entities in same cell", () => {
      const hash = new SpatialHash(100);
      // Both entities within the same 100-unit cell
      hash.insert(1, 10, 10, 10);
      hash.insert(2, 20, 20, 20);
      expect(hash.cellCount).toBe(1);
    });

    it("should place distant entities in different cells", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 150, 0, 0);  // Different cell on X axis
      expect(hash.cellCount).toBe(2);
    });

    it("should handle negative coordinates", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, -50, -50, -50);
      hash.insert(2, 50, 50, 50);
      const results1 = hash.query(-50, -50, -50, 10);
      const results2 = hash.query(50, 50, 50, 10);
      expect(results1).toContain(1);
      expect(results2).toContain(2);
    });
  });

  describe("query", () => {
    it("should find entities within radius", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 10, 0, 0);
      hash.insert(3, 500, 0, 0);  // Far away

      const results = hash.query(5, 0, 0, 20);
      expect(results).toContain(1);
      expect(results).toContain(2);
      expect(results).not.toContain(3);
    });

    it("should return empty array when no entities nearby", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 1000, 1000, 1000);

      const results = hash.query(0, 0, 0, 50);
      expect(results).toHaveLength(0);
    });

    it("should query across cell boundaries", () => {
      const hash = new SpatialHash(100);
      // Entity at edge of cell 0
      hash.insert(1, 95, 0, 0);
      // Entity in cell 1
      hash.insert(2, 105, 0, 0);

      // Query from position that spans both cells
      const results = hash.query(100, 0, 0, 20);
      expect(results).toContain(1);
      expect(results).toContain(2);
    });

    it("should handle 3D queries correctly", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 0, 0, 250);  // Far in Z - definitely different cell
      hash.insert(3, 0, 250, 0);  // Far in Y - definitely different cell
      hash.insert(4, 250, 0, 0);  // Far in X - definitely different cell

      // With cell size 100 and radius 50, query covers [-1,0] cells
      // Entity at 250 is in cell 2, which is outside [-1,0] range
      const results = hash.query(0, 0, 0, 50);
      expect(results).toContain(1);
      expect(results).not.toContain(2);
      expect(results).not.toContain(3);
      expect(results).not.toContain(4);
    });

    it("should handle large query radius", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 200, 0, 0);
      hash.insert(3, 0, 200, 0);

      // Large radius should get all
      const results = hash.query(100, 100, 0, 250);
      expect(results).toContain(1);
      expect(results).toContain(2);
      expect(results).toContain(3);
    });
  });

  describe("per-frame usage pattern", () => {
    it("should handle clear + insert + query cycle", () => {
      const hash = new SpatialHash(100);

      // Frame 1: Entities at positions
      hash.insert(1, 0, 0, 0);
      hash.insert(2, 50, 0, 0);
      let results = hash.query(25, 0, 0, 50);
      expect(results).toHaveLength(2);

      // Frame 2: Clear and reinsert at distant positions
      // Move entities far enough that they're outside the query cell range
      hash.clear();
      hash.insert(1, 500, 0, 0);  // Cell 5
      hash.insert(2, 550, 0, 0);  // Cell 5
      // Query at 25 with radius 50 checks cells -1 to 1, won't reach cell 5
      results = hash.query(25, 0, 0, 50);
      expect(results).toHaveLength(0);

      // Query near the new positions
      results = hash.query(525, 0, 0, 50);
      expect(results).toHaveLength(2);
    });

    it("should handle many entities efficiently", () => {
      const hash = new SpatialHash(100);

      // Insert 100 entities in a grid pattern
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 50;
        const z = Math.floor(i / 10) * 50;
        hash.insert(i, x, 0, z);
      }

      expect(hash.entityCount).toBe(100);

      // Query should only return entities in nearby cells
      const results = hash.query(25, 0, 25, 30);
      // Should find entities near origin, not all 100
      expect(results.length).toBeLessThan(20);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("should handle entity at exact cell boundary", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 100, 0, 0);  // Exactly at cell boundary
      const results = hash.query(100, 0, 0, 10);
      expect(results).toContain(1);
    });

    it("should handle zero radius query", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 0, 0, 0);
      // Zero radius should still check the cell the point is in
      const results = hash.query(0, 0, 0, 0);
      expect(results).toContain(1);
    });

    it("should handle multiple entities at same position", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 50, 50, 50);
      hash.insert(2, 50, 50, 50);
      hash.insert(3, 50, 50, 50);

      const results = hash.query(50, 50, 50, 10);
      expect(results).toContain(1);
      expect(results).toContain(2);
      expect(results).toContain(3);
      expect(results).toHaveLength(3);
    });

    it("should handle very large coordinates", () => {
      const hash = new SpatialHash(100);
      hash.insert(1, 10000, 10000, 10000);
      hash.insert(2, 10050, 10000, 10000);

      const results = hash.query(10025, 10000, 10000, 50);
      expect(results).toContain(1);
      expect(results).toContain(2);
    });
  });

  describe("collision detection scenario", () => {
    it("should efficiently find collision candidates", () => {
      const hash = new SpatialHash(100);

      // Simulate targets distributed in space
      const targets = [
        { eid: 1, x: 0, y: 0, z: 0 },
        { eid: 2, x: 200, y: 0, z: 0 },
        { eid: 3, x: 0, y: 200, z: 0 },
        { eid: 4, x: 0, y: 0, z: 200 },
        { eid: 5, x: 500, y: 500, z: 500 },
      ];

      for (const t of targets) {
        hash.insert(t.eid, t.x, t.y, t.z);
      }

      // Projectile near target 1
      const candidates = hash.query(5, 5, 5, 30);
      expect(candidates).toContain(1);
      expect(candidates).not.toContain(5);  // Too far

      // Projectile near target 5
      const candidates2 = hash.query(495, 495, 495, 30);
      expect(candidates2).toContain(5);
      expect(candidates2).not.toContain(1);  // Too far
    });
  });
});

/**
 * SpatialHash - 3D Spatial Hash Grid for efficient collision queries
 * Reduces O(n*m) collision detection to O(n*k) where k = avg entities per cell
 */

/**
 * 3D Spatial Hash for efficient proximity queries
 *
 * Usage:
 * 1. Call clear() at start of frame
 * 2. Call insert() for all entities that can be targets
 * 3. Call query() for each entity that needs to find nearby targets
 */
export class SpatialHash {
  private cellSize: number;
  private grid = new Map<string, number[]>();

  /**
   * @param cellSize - Size of each grid cell. Larger = fewer cells, more entities per cell.
   *                   Recommended: ~2x the maximum query radius for best performance.
   */
  constructor(cellSize: number = 100) {
    this.cellSize = cellSize;
  }

  /**
   * Hash 3D coordinates to a cell key
   */
  private hash(x: number, y: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cy},${cz}`;
  }

  /**
   * Clear all entities from the grid. Call at start of each frame.
   */
  clear(): void {
    this.grid.clear();
  }

  /**
   * Insert an entity into the grid at a position
   */
  insert(eid: number, x: number, y: number, z: number): void {
    const key = this.hash(x, y, z);
    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }
    cell.push(eid);
  }

  /**
   * Query all entity IDs within radius of a point.
   * Returns entities from all cells that could possibly contain entities within radius.
   * Caller must still do distance checks for exact collision detection.
   *
   * @param x - Query center X
   * @param y - Query center Y
   * @param z - Query center Z
   * @param radius - Maximum distance to search
   * @returns Array of entity IDs that might be within radius (broad phase)
   */
  query(x: number, y: number, z: number, radius: number): number[] {
    const results: number[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);

    // Check all cells within the radius bounds
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          const cell = this.grid.get(key);
          if (cell) {
            results.push(...cell);
          }
        }
      }
    }
    return results;
  }

  /**
   * Get number of occupied cells (for debugging/profiling)
   */
  get cellCount(): number {
    return this.grid.size;
  }

  /**
   * Get total entity count (for debugging/profiling)
   */
  get entityCount(): number {
    let count = 0;
    for (const cell of this.grid.values()) {
      count += cell.length;
    }
    return count;
  }
}

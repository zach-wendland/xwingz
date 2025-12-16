/**
 * SeededRNG - A deterministic pseudo-random number generator
 *
 * Uses a Linear Congruential Generator (LCG) algorithm for fast,
 * reproducible random number generation. Essential for deterministic
 * gameplay, replays, and network synchronization.
 *
 * LCG Parameters (glibc constants):
 * - Multiplier: 1103515245
 * - Increment: 12345
 * - Modulus: 2^31 (via bitmask 0x7fffffff)
 */
export class SeededRNG {
  private state: number;

  /**
   * Create a new SeededRNG with the given seed.
   * @param seed - Initial seed value (will be masked to 31 bits)
   */
  constructor(seed: number) {
    this.state = seed & 0x7fffffff;
  }

  /**
   * Generate the next random number in the sequence.
   * @returns A value in the range [0, 1]
   */
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }

  /**
   * Generate a random number within a range.
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (exclusive)
   * @returns A value in the range [min, max)
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate a random integer within a range.
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @returns An integer in the range [min, max]
   */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Reset the RNG to a new seed.
   * @param seed - New seed value (will be masked to 31 bits)
   */
  reset(seed: number): void {
    this.state = seed & 0x7fffffff;
  }

  /**
   * Get the current internal state for serialization.
   * @returns The current state value
   */
  getState(): number {
    return this.state;
  }

  /**
   * Set the internal state for deserialization.
   * @param state - State value to restore (will be masked to 31 bits)
   */
  setState(state: number): void {
    this.state = state & 0x7fffffff;
  }
}

/**
 * Global singleton RNG instance for convenience.
 * Use setGlobalSeed() to reset for deterministic sequences.
 */
export const globalRNG = new SeededRNG(12345);

/**
 * Reset the global RNG to a specific seed.
 * Call this at the start of a game/level for reproducibility.
 * @param seed - Seed value to use
 */
export function setGlobalSeed(seed: number): void {
  globalRNG.reset(seed);
}

/**
 * Get a random number from the global RNG.
 * Drop-in replacement for Math.random() with deterministic behavior.
 * @returns A value in the range [0, 1]
 */
export function seededRandom(): number {
  return globalRNG.next();
}

/**
 * Get a random number within a range from the global RNG.
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (exclusive)
 * @returns A value in the range [min, max)
 */
export function seededRange(min: number, max: number): number {
  return globalRNG.range(min, max);
}

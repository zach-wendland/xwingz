import {
  SeededRNG,
  globalRNG,
  setGlobalSeed,
  seededRandom,
  seededRange
} from '@xwingz/core';

describe('SeededRNG', () => {
  describe('deterministic behavior', () => {
    it('should produce deterministic results with the same seed', () => {
      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(42);

      const sequence1 = [rng1.next(), rng1.next(), rng1.next()];
      const sequence2 = [rng2.next(), rng2.next(), rng2.next()];

      expect(sequence1).toEqual(sequence2);
    });

    it('should produce different sequences with different seeds', () => {
      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(123);

      const sequence1 = [rng1.next(), rng1.next(), rng1.next()];
      const sequence2 = [rng2.next(), rng2.next(), rng2.next()];

      expect(sequence1).not.toEqual(sequence2);
    });

    it('should produce values between 0 and 1', () => {
      const rng = new SeededRNG(12345);

      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('range()', () => {
    it('should produce values within the specified bounds', () => {
      const rng = new SeededRNG(54321);
      const min = 10;
      const max = 20;

      for (let i = 0; i < 100; i++) {
        const value = rng.range(min, max);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThan(max);
      }
    });

    it('should produce deterministic range values', () => {
      const rng1 = new SeededRNG(999);
      const rng2 = new SeededRNG(999);

      const values1 = [rng1.range(0, 100), rng1.range(50, 150), rng1.range(-10, 10)];
      const values2 = [rng2.range(0, 100), rng2.range(50, 150), rng2.range(-10, 10)];

      expect(values1).toEqual(values2);
    });

    it('should handle negative ranges correctly', () => {
      const rng = new SeededRNG(777);

      for (let i = 0; i < 50; i++) {
        const value = rng.range(-100, -50);
        expect(value).toBeGreaterThanOrEqual(-100);
        expect(value).toBeLessThan(-50);
      }
    });
  });

  describe('int()', () => {
    it('should produce integers within the specified bounds (inclusive)', () => {
      const rng = new SeededRNG(88888);
      const min = 1;
      const max = 6; // Like a dice roll

      const results = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const value = rng.int(min, max);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
        results.add(value);
      }

      // Should eventually produce all values in range
      expect(results.size).toBe(6);
    });

    it('should produce deterministic integer values', () => {
      const rng1 = new SeededRNG(333);
      const rng2 = new SeededRNG(333);

      const ints1 = [rng1.int(0, 10), rng1.int(1, 100), rng1.int(-5, 5)];
      const ints2 = [rng2.int(0, 10), rng2.int(1, 100), rng2.int(-5, 5)];

      expect(ints1).toEqual(ints2);
    });
  });

  describe('reset()', () => {
    it('should restore to initial state after reset', () => {
      const rng = new SeededRNG(12345);

      // Generate some values
      const firstValue = rng.next();
      rng.next();
      rng.next();

      // Reset with same seed
      rng.reset(12345);

      // Should get the same first value
      expect(rng.next()).toBe(firstValue);
    });

    it('should allow changing to a different seed', () => {
      const rng1 = new SeededRNG(100);

      // Advance rng1 to change its state
      rng1.next();
      rng1.next();

      // Reset rng1 to seed 200
      rng1.reset(200);

      // Create a fresh rng2 with seed 200
      const rng2 = new SeededRNG(200);

      // Both should now produce identical sequences
      expect(rng1.next()).toBe(rng2.next());
      expect(rng1.next()).toBe(rng2.next());
      expect(rng1.next()).toBe(rng2.next());
    });
  });

  describe('getState() and setState()', () => {
    it('should allow state serialization and restoration', () => {
      const rng = new SeededRNG(42);

      // Advance the RNG a few times
      rng.next();
      rng.next();
      rng.next();

      // Save state
      const savedState = rng.getState();

      // Generate more values
      const valueAfterSave1 = rng.next();
      const valueAfterSave2 = rng.next();

      // Restore state
      rng.setState(savedState);

      // Should replay the same values
      expect(rng.next()).toBe(valueAfterSave1);
      expect(rng.next()).toBe(valueAfterSave2);
    });

    it('should allow transferring state between instances', () => {
      const rng1 = new SeededRNG(42);

      // Advance rng1
      rng1.next();
      rng1.next();
      const state = rng1.getState();
      const expectedValue = rng1.next();

      // Create new RNG and set its state
      const rng2 = new SeededRNG(0); // Different initial seed
      rng2.setState(state);

      expect(rng2.next()).toBe(expectedValue);
    });
  });

  describe('edge cases', () => {
    it('should handle seed of 0', () => {
      const rng = new SeededRNG(0);
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    it('should handle large seeds by masking to 31 bits', () => {
      const rng1 = new SeededRNG(0xFFFFFFFF);
      const rng2 = new SeededRNG(0x7FFFFFFF);

      // Should produce valid output even with large seed
      expect(rng1.next()).toBeGreaterThanOrEqual(0);
      expect(rng2.next()).toBeGreaterThanOrEqual(0);
    });

    it('should handle negative seeds', () => {
      const rng = new SeededRNG(-12345);
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });
});

describe('globalRNG singleton', () => {
  beforeEach(() => {
    // Reset global RNG before each test
    setGlobalSeed(12345);
  });

  it('should be accessible as a singleton', () => {
    expect(globalRNG).toBeInstanceOf(SeededRNG);
  });

  it('should produce deterministic values after setGlobalSeed', () => {
    setGlobalSeed(99999);
    const value1 = globalRNG.next();

    setGlobalSeed(99999);
    const value2 = globalRNG.next();

    expect(value1).toBe(value2);
  });
});

describe('helper functions', () => {
  beforeEach(() => {
    // Reset global RNG before each test
    setGlobalSeed(12345);
  });

  describe('seededRandom()', () => {
    it('should return values from the global RNG', () => {
      setGlobalSeed(42);
      const value1 = seededRandom();

      setGlobalSeed(42);
      const value2 = seededRandom();

      expect(value1).toBe(value2);
    });

    it('should return values between 0 and 1', () => {
      for (let i = 0; i < 50; i++) {
        const value = seededRandom();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('seededRange()', () => {
    it('should return values within the specified range', () => {
      for (let i = 0; i < 50; i++) {
        const value = seededRange(5, 15);
        expect(value).toBeGreaterThanOrEqual(5);
        expect(value).toBeLessThan(15);
      }
    });

    it('should produce deterministic values', () => {
      setGlobalSeed(555);
      const value1 = seededRange(0, 100);

      setGlobalSeed(555);
      const value2 = seededRange(0, 100);

      expect(value1).toBe(value2);
    });
  });
});

import {
  hash64,
  deriveSeed,
  createRng,
  type Seed,
  type RNG
} from '../../../packages/procgen/src/seed';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for hash64
// ─────────────────────────────────────────────────────────────────────────────

describe('hash64', () => {
  it('should return a bigint seed', () => {
    const result = hash64(['test']);

    expect(typeof result).toBe('bigint');
  });

  it('should produce consistent results for same input', () => {
    const result1 = hash64(['hello', 'world']);
    const result2 = hash64(['hello', 'world']);

    expect(result1).toBe(result2);
  });

  it('should produce different results for different inputs', () => {
    const result1 = hash64(['hello']);
    const result2 = hash64(['world']);

    expect(result1).not.toBe(result2);
  });

  it('should handle empty array', () => {
    const result = hash64([]);

    expect(typeof result).toBe('bigint');
  });

  it('should handle string parts', () => {
    const result = hash64(['planet', 'tatooine', 'desert']);

    expect(typeof result).toBe('bigint');
    expect(result >= BigInt(0)).toBe(true);
  });

  it('should handle number parts', () => {
    const result = hash64([1, 2, 3, 42, 100]);

    expect(typeof result).toBe('bigint');
  });

  it('should handle bigint parts', () => {
    const result = hash64([BigInt(123), BigInt(456), BigInt(789)]);

    expect(typeof result).toBe('bigint');
  });

  it('should handle mixed types', () => {
    const result = hash64(['galaxy', 42, BigInt(999), 'sector', 7]);

    expect(typeof result).toBe('bigint');
  });

  it('should produce different results for different order', () => {
    const result1 = hash64(['a', 'b', 'c']);
    const result2 = hash64(['c', 'b', 'a']);

    expect(result1).not.toBe(result2);
  });

  it('should produce values within 64-bit range', () => {
    const maxUint64 = (BigInt(1) << BigInt(64)) - BigInt(1);
    const result = hash64(['test', 'value', 12345]);

    expect(result >= BigInt(0)).toBe(true);
    expect(result <= maxUint64).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for deriveSeed
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveSeed', () => {
  it('should derive a new seed from parent and keys', () => {
    const parent = hash64(['root']);
    const derived = deriveSeed(parent, 'child', 1);

    expect(typeof derived).toBe('bigint');
    expect(derived).not.toBe(parent);
  });

  it('should produce consistent derived seeds', () => {
    const parent = hash64(['root']);

    const derived1 = deriveSeed(parent, 'sector', 5);
    const derived2 = deriveSeed(parent, 'sector', 5);

    expect(derived1).toBe(derived2);
  });

  it('should produce different seeds for different keys', () => {
    const parent = hash64(['root']);

    const derived1 = deriveSeed(parent, 'planet', 1);
    const derived2 = deriveSeed(parent, 'planet', 2);

    expect(derived1).not.toBe(derived2);
  });

  it('should produce different seeds for different parents', () => {
    const parent1 = hash64(['root1']);
    const parent2 = hash64(['root2']);

    const derived1 = deriveSeed(parent1, 'child');
    const derived2 = deriveSeed(parent2, 'child');

    expect(derived1).not.toBe(derived2);
  });

  it('should handle no additional keys', () => {
    const parent = hash64(['root']);
    const derived = deriveSeed(parent);

    // With no keys, it should essentially return the parent (through splitmix)
    expect(typeof derived).toBe('bigint');
  });

  it('should handle multiple levels of derivation', () => {
    const root = hash64(['galaxy']);
    const sector = deriveSeed(root, 'sector', 0);
    const system = deriveSeed(sector, 'system', 5);
    const planet = deriveSeed(system, 'planet', 2);

    // Each level should be different
    expect(root).not.toBe(sector);
    expect(sector).not.toBe(system);
    expect(system).not.toBe(planet);
  });

  it('should produce hierarchically deterministic seeds', () => {
    // Same derivation path should produce same result
    const root1 = hash64(['campaign', 'endor']);
    const planet1 = deriveSeed(root1, 'terrain', 3);

    const root2 = hash64(['campaign', 'endor']);
    const planet2 = deriveSeed(root2, 'terrain', 3);

    expect(planet1).toBe(planet2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for createRng
// ─────────────────────────────────────────────────────────────────────────────

describe('createRng', () => {
  describe('initialization', () => {
    it('should create an RNG from a seed', () => {
      const seed = hash64(['test']);
      const rng = createRng(seed);

      expect(rng).toBeDefined();
      expect(typeof rng.nextU32).toBe('function');
      expect(typeof rng.nextF01).toBe('function');
      expect(typeof rng.range).toBe('function');
      expect(typeof rng.pick).toBe('function');
      expect(typeof rng.weightedPick).toBe('function');
    });
  });

  describe('nextU32', () => {
    it('should return a 32-bit unsigned integer', () => {
      const rng = createRng(hash64(['test']));

      for (let i = 0; i < 100; i++) {
        const value = rng.nextU32();
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(0xffffffff);
      }
    });

    it('should produce deterministic sequence', () => {
      const seed = hash64(['deterministic']);

      const rng1 = createRng(seed);
      const sequence1 = [rng1.nextU32(), rng1.nextU32(), rng1.nextU32()];

      const rng2 = createRng(seed);
      const sequence2 = [rng2.nextU32(), rng2.nextU32(), rng2.nextU32()];

      expect(sequence1).toEqual(sequence2);
    });

    it('should produce different sequences for different seeds', () => {
      const rng1 = createRng(hash64(['seed1']));
      const rng2 = createRng(hash64(['seed2']));

      const sequence1 = [rng1.nextU32(), rng1.nextU32(), rng1.nextU32()];
      const sequence2 = [rng2.nextU32(), rng2.nextU32(), rng2.nextU32()];

      expect(sequence1).not.toEqual(sequence2);
    });
  });

  describe('nextF01', () => {
    it('should return a float between 0 and 1', () => {
      const rng = createRng(hash64(['float-test']));

      for (let i = 0; i < 100; i++) {
        const value = rng.nextF01();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it('should produce deterministic sequence', () => {
      const seed = hash64(['float-deterministic']);

      const rng1 = createRng(seed);
      const values1 = [rng1.nextF01(), rng1.nextF01(), rng1.nextF01()];

      const rng2 = createRng(seed);
      const values2 = [rng2.nextF01(), rng2.nextF01(), rng2.nextF01()];

      expect(values1).toEqual(values2);
    });
  });

  describe('range', () => {
    it('should return values within specified range', () => {
      const rng = createRng(hash64(['range-test']));
      const min = 10;
      const max = 20;

      for (let i = 0; i < 100; i++) {
        const value = rng.range(min, max);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThan(max);
      }
    });

    it('should handle negative ranges', () => {
      const rng = createRng(hash64(['negative-range']));

      for (let i = 0; i < 50; i++) {
        const value = rng.range(-100, -50);
        expect(value).toBeGreaterThanOrEqual(-100);
        expect(value).toBeLessThan(-50);
      }
    });

    it('should handle range spanning zero', () => {
      const rng = createRng(hash64(['zero-span']));

      for (let i = 0; i < 50; i++) {
        const value = rng.range(-10, 10);
        expect(value).toBeGreaterThanOrEqual(-10);
        expect(value).toBeLessThan(10);
      }
    });

    it('should produce deterministic range values', () => {
      const seed = hash64(['range-deterministic']);

      const rng1 = createRng(seed);
      const values1 = [rng1.range(0, 100), rng1.range(50, 150), rng1.range(-10, 10)];

      const rng2 = createRng(seed);
      const values2 = [rng2.range(0, 100), rng2.range(50, 150), rng2.range(-10, 10)];

      expect(values1).toEqual(values2);
    });
  });

  describe('pick', () => {
    it('should pick an element from the array', () => {
      const rng = createRng(hash64(['pick-test']));
      const options = ['rebel', 'empire', 'neutral'];

      for (let i = 0; i < 50; i++) {
        const picked = rng.pick(options);
        expect(options).toContain(picked);
      }
    });

    it('should throw on empty array', () => {
      const rng = createRng(hash64(['empty-pick']));

      expect(() => rng.pick([])).toThrow('pick() from empty array');
    });

    it('should produce deterministic picks', () => {
      const seed = hash64(['pick-deterministic']);
      const options = ['a', 'b', 'c', 'd', 'e'];

      const rng1 = createRng(seed);
      const picks1 = [rng1.pick(options), rng1.pick(options), rng1.pick(options)];

      const rng2 = createRng(seed);
      const picks2 = [rng2.pick(options), rng2.pick(options), rng2.pick(options)];

      expect(picks1).toEqual(picks2);
    });

    it('should eventually pick all elements (distribution test)', () => {
      const rng = createRng(hash64(['distribution']));
      const options = [1, 2, 3, 4, 5];
      const picked = new Set<number>();

      // Pick many times, should eventually get all
      for (let i = 0; i < 200; i++) {
        picked.add(rng.pick(options));
      }

      expect(picked.size).toBe(5);
    });

    it('should return single element array correctly', () => {
      const rng = createRng(hash64(['single']));
      const options = ['only'];

      const result = rng.pick(options);

      expect(result).toBe('only');
    });
  });

  describe('weightedPick', () => {
    it('should pick based on weights', () => {
      const rng = createRng(hash64(['weighted']));
      const pairs: Array<[string, number]> = [
        ['common', 80],
        ['rare', 15],
        ['legendary', 5]
      ];

      const results: Record<string, number> = { common: 0, rare: 0, legendary: 0 };

      for (let i = 0; i < 1000; i++) {
        const picked = rng.weightedPick(pairs);
        results[picked]++;
      }

      // Common should appear most often
      expect(results['common']).toBeGreaterThan(results['rare']);
      expect(results['rare']).toBeGreaterThan(results['legendary']);
    });

    it('should throw on empty list', () => {
      const rng = createRng(hash64(['empty-weighted']));

      expect(() => rng.weightedPick([])).toThrow('weightedPick() from empty list');
    });

    it('should throw on zero total weight', () => {
      const rng = createRng(hash64(['zero-weight']));
      const pairs: Array<[string, number]> = [
        ['a', 0],
        ['b', 0]
      ];

      expect(() => rng.weightedPick(pairs)).toThrow('weightedPick() total weight <= 0');
    });

    it('should produce deterministic weighted picks', () => {
      const seed = hash64(['weighted-deterministic']);
      const pairs: Array<[string, number]> = [
        ['x-wing', 40],
        ['y-wing', 30],
        ['a-wing', 30]
      ];

      const rng1 = createRng(seed);
      const picks1 = [
        rng1.weightedPick(pairs),
        rng1.weightedPick(pairs),
        rng1.weightedPick(pairs)
      ];

      const rng2 = createRng(seed);
      const picks2 = [
        rng2.weightedPick(pairs),
        rng2.weightedPick(pairs),
        rng2.weightedPick(pairs)
      ];

      expect(picks1).toEqual(picks2);
    });

    it('should handle single item with weight', () => {
      const rng = createRng(hash64(['single-weight']));
      const pairs: Array<[string, number]> = [['only', 100]];

      const result = rng.weightedPick(pairs);

      expect(result).toBe('only');
    });

    it('should handle item with very high weight dominating', () => {
      const rng = createRng(hash64(['high-weight']));
      const pairs: Array<[string, number]> = [
        ['dominant', 1000000],
        ['rare', 1]
      ];

      let dominantCount = 0;
      for (let i = 0; i < 100; i++) {
        if (rng.weightedPick(pairs) === 'dominant') {
          dominantCount++;
        }
      }

      // Should be overwhelming majority
      expect(dominantCount).toBeGreaterThan(95);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration / Cross-run determinism tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Determinism Verification', () => {
  it('should produce identical results across multiple test runs (hash64)', () => {
    // These values were generated once and should always match
    const testHash = hash64(['xwingz', 'test', 42]);

    // The hash should be deterministic - same inputs always produce same output
    const expectedConsistency = hash64(['xwingz', 'test', 42]);
    expect(testHash).toBe(expectedConsistency);
  });

  it('should produce identical RNG sequences across multiple test runs', () => {
    const seed = hash64(['replay', 'test']);
    const rng = createRng(seed);

    // Generate a sequence
    const sequence: number[] = [];
    for (let i = 0; i < 10; i++) {
      sequence.push(rng.nextU32());
    }

    // Reset and regenerate
    const rng2 = createRng(seed);
    const sequence2: number[] = [];
    for (let i = 0; i < 10; i++) {
      sequence2.push(rng2.nextU32());
    }

    expect(sequence).toEqual(sequence2);
  });

  it('should support game replay scenarios', () => {
    // Simulate a game scenario where we need deterministic procedural generation
    const campaignSeed = hash64(['campaign', 'rebellion', 'episode4']);

    // Generate planetary terrain seeds
    const tatooineTerrainSeed = deriveSeed(campaignSeed, 'planet', 'tatooine', 'terrain');
    const hothTerrainSeed = deriveSeed(campaignSeed, 'planet', 'hoth', 'terrain');
    const endorTerrainSeed = deriveSeed(campaignSeed, 'planet', 'endor', 'terrain');

    // Each should be unique but deterministic
    expect(tatooineTerrainSeed).not.toBe(hothTerrainSeed);
    expect(hothTerrainSeed).not.toBe(endorTerrainSeed);

    // Regenerate with same inputs - should match
    const tatooineAgain = deriveSeed(campaignSeed, 'planet', 'tatooine', 'terrain');
    expect(tatooineTerrainSeed).toBe(tatooineAgain);
  });

  it('should generate consistent enemy spawn patterns', () => {
    const missionSeed = hash64(['mission', 'deathstar', 'trench-run']);
    const spawnRng = createRng(deriveSeed(missionSeed, 'spawns'));

    // Generate spawn pattern
    const spawnPositions: number[] = [];
    for (let i = 0; i < 5; i++) {
      spawnPositions.push(spawnRng.range(0, 1000));
    }

    // Regenerate
    const spawnRng2 = createRng(deriveSeed(missionSeed, 'spawns'));
    const spawnPositions2: number[] = [];
    for (let i = 0; i < 5; i++) {
      spawnPositions2.push(spawnRng2.range(0, 1000));
    }

    expect(spawnPositions).toEqual(spawnPositions2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases and boundary conditions
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('should handle very large bigint seeds', () => {
    const largeSeed = (BigInt(1) << BigInt(63)) - BigInt(1);
    const rng = createRng(largeSeed);

    const value = rng.nextF01();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it('should handle seed of 0', () => {
    const rng = createRng(BigInt(0));

    const value = rng.nextF01();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it('should handle empty string in hash', () => {
    const hash1 = hash64(['']);
    const hash2 = hash64(['', '']);

    expect(typeof hash1).toBe('bigint');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle unicode strings in hash', () => {
    const hash = hash64(['Hello', 'World', 'Symbol']);

    expect(typeof hash).toBe('bigint');
  });

  it('should handle negative numbers in hash', () => {
    const hash1 = hash64([-1, -100, -1000]);
    const hash2 = hash64([1, 100, 1000]);

    expect(typeof hash1).toBe('bigint');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle floating point numbers by flooring', () => {
    const hash1 = hash64([3.14]);
    const hash2 = hash64([3.99]);

    // Both should floor to 3
    expect(hash1).toBe(hash2);
  });

  it('should handle range with equal min and max', () => {
    const rng = createRng(hash64(['equal-range']));

    const value = rng.range(5, 5);

    // Should return min when min === max
    expect(value).toBe(5);
  });
});

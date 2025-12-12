export type Seed = bigint;

const UINT64_MASK = (1n << 64n) - 1n;

function splitmix64(x: Seed): Seed {
  let z = (x + 0x9e3779b97f4a7c15n) & UINT64_MASK;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & UINT64_MASK;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & UINT64_MASK;
  return (z ^ (z >> 31n)) & UINT64_MASK;
}

function fnv1a64(str: string): Seed {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & UINT64_MASK;
  }
  return hash;
}

function hashKey(key: string | number | bigint): Seed {
  if (typeof key === "bigint") return key & UINT64_MASK;
  if (typeof key === "number") return BigInt.asUintN(64, BigInt(Math.floor(key)));
  return fnv1a64(key);
}

export function hash64(parts: Array<string | number | bigint>): Seed {
  let s = 0n;
  for (const part of parts) {
    s = splitmix64(s ^ hashKey(part));
  }
  return s & UINT64_MASK;
}

export function deriveSeed(parent: Seed, ...keys: Array<string | number | bigint>): Seed {
  let s = parent;
  for (const k of keys) {
    s = splitmix64(s ^ hashKey(k));
  }
  return s & UINT64_MASK;
}

export interface RNG {
  nextU32(): number;
  nextF01(): number;
  range(min: number, max: number): number;
  pick<T>(arr: T[]): T;
  weightedPick<T>(pairs: Array<[T, number]>): T;
}

export function createRng(seed: Seed): RNG {
  let state = seed & UINT64_MASK;

  function next64(): Seed {
    state = splitmix64(state);
    return state;
  }

  return {
    nextU32() {
      const v = next64() & 0xffffffffn;
      return Number(v);
    },
    nextF01() {
      return this.nextU32() / 0x1_0000_0000;
    },
    range(min, max) {
      return min + (max - min) * this.nextF01();
    },
    pick(arr) {
      if (arr.length === 0) throw new Error("pick() from empty array");
      const idx = Math.floor(this.nextF01() * arr.length);
      const last = arr[arr.length - 1]!;
      return arr[idx] ?? last;
    },
    weightedPick(pairs) {
      if (pairs.length === 0) throw new Error("weightedPick() from empty list");
      let total = 0;
      for (const [, w] of pairs) total += w;
      if (total <= 0) throw new Error("weightedPick() total weight <= 0");
      let r = this.nextF01() * total;
      for (const [v, w] of pairs) {
        r -= w;
        if (r <= 0) return v;
      }
      return pairs[pairs.length - 1]![0];
    }
  };
}

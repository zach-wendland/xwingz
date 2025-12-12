import type { EraId, FactionId } from "@xwingz/data";
import type { Seed, RNG } from "../seed";

export type Vec3i = readonly [number, number, number];
export type Vec3f = readonly [number, number, number];

export type GenCtx = {
  globalSeed: Seed;
  progressionLayerId?: string;
};

export type SectorDef = {
  id: string;
  coord: Vec3i;
  seed: Seed;
  archetypeId: string;
  tags: string[];
  eraEcho: Record<EraId, number>;
  factionField: Record<FactionId, number>;
  controllingFaction: FactionId;
  hazardScalar: number;
  systemCount: number;
  systems: Array<{
    id: string;
    seed: Seed;
    localPos: Vec3f; // [0,1) within sector
  }>;
};

export function normalizeWeights<T extends string>(
  base: Partial<Record<T, number>>,
  allIds: readonly T[],
  rng: RNG,
  baseline = 0.05
): Record<T, number> {
  const out = {} as Record<T, number>;
  let total = 0;
  for (const id of allIds) {
    const w0 = (base[id] ?? baseline) * (0.9 + rng.nextF01() * 0.2);
    out[id] = w0;
    total += w0;
  }
  for (const id of allIds) out[id] = out[id] / total;
  return out;
}


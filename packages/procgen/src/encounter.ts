import {
  FIGHTER_ARCHETYPES,
  type FighterArchetypeId,
  type FactionId
} from "@xwingz/data";
import { createRng, deriveSeed, type Seed } from "./seed";
import type { SystemDef } from "./galaxy/system";

export type EncounterDef = {
  seed: Seed;
  count: number;
  archetypes: FighterArchetypeId[];
  spawnRing: { min: number; max: number };
};

function enemyWeightsForFaction(faction: FactionId): Array<[FighterArchetypeId, number]> {
  switch (faction) {
    case "empire":
      return [
        ["tie_ln", 0.75],
        ["z95", 0.15],
        ["pirate_fang", 0.1]
      ];
    case "pirates":
    case "hutts":
      return [
        ["pirate_fang", 0.6],
        ["z95", 0.3],
        ["tie_ln", 0.1]
      ];
    default:
      return [
        ["z95", 0.6],
        ["pirate_fang", 0.25],
        ["tie_ln", 0.15]
      ];
  }
}

export function getEncounter(system: SystemDef, progressionLayerId = "v0"): EncounterDef {
  const seed = deriveSeed(system.seed, "encounter", progressionLayerId);
  const rng = createRng(seed);

  const densityScalar = 0.8 + (system.poiDensity ?? 0.5) * 0.6;
  const rawCount = rng.range(2, 6) * densityScalar;
  const count = Math.max(1, Math.round(rawCount));

  const weights = enemyWeightsForFaction(system.controllingFaction);
  const archetypes: FighterArchetypeId[] = [];
  for (let i = 0; i < count; i++) {
    archetypes.push(rng.weightedPick(weights));
  }

  // Spread enemies a bit farther in denser systems.
  const min = 260 + count * 30;
  const max = 650 + count * 60;

  return {
    seed,
    count,
    archetypes,
    spawnRing: { min, max }
  };
}

export function getFighterArchetype(id: FighterArchetypeId) {
  const a = FIGHTER_ARCHETYPES.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown fighter archetype: ${id}`);
  return a;
}


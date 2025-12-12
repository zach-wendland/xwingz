import {
  STAR_CLASS_IDS,
  SYSTEM_ARCHETYPES,
  type StarClassId,
  type SystemArchetype,
  type FactionId
} from "@xwingz/data";
import { createRng, deriveSeed, type Seed } from "../seed";
import type { GenCtx, SectorDef, Vec3f } from "./types";

export type EconomyProfile = {
  wealth: number; // 0..1
  industry: number; // 0..1
  security: number; // 0..1
};

export type SystemDef = {
  id: string;
  seed: Seed;
  sectorId: string;
  sectorCoord: SectorDef["coord"];
  localPos: Vec3f;
  galaxyPos: Vec3f;
  archetypeId: string;
  tags: string[];
  starClass: StarClassId;
  planetCount: number;
  poiDensity: number;
  controllingFaction: FactionId;
  economy: EconomyProfile;
  storyAnchorChance: number;
};

function pickArchetype(seed: Seed): SystemArchetype {
  const rng = createRng(seed);
  return rng.pick(SYSTEM_ARCHETYPES);
}

function weightedPickStarClass(archetype: SystemArchetype, rng: ReturnType<typeof createRng>): StarClassId {
  const pairs = STAR_CLASS_IDS.map((id) => [id, archetype.starClassWeights[id] ?? 1]) as Array<
    [StarClassId, number]
  >;
  return rng.weightedPick(pairs);
}

export function getSystem(
  sector: SectorDef,
  systemIndex: number,
  ctx: GenCtx
): SystemDef {
  const sysEntry = sector.systems[systemIndex];
  if (!sysEntry) throw new Error(`systemIndex ${systemIndex} out of range`);

  const systemSeed = sysEntry.seed ?? deriveSeed(sector.seed, "system", systemIndex);
  const rng = createRng(systemSeed);

  const archetype = pickArchetype(systemSeed);
  const starClass = weightedPickStarClass(archetype, rng);

  const planetCount = Math.floor(rng.range(archetype.planetCountRange[0], archetype.planetCountRange[1] + 1));
  const poiDensity = rng.range(archetype.poiDensityRange[0], archetype.poiDensityRange[1]);

  // Simple economy stub: later becomes supply/demand simulation.
  const wealth = Math.min(1, Math.max(0, (1 - sector.hazardScalar) * rng.range(0.6, 1.0)));
  const industry = rng.range(0.2, 0.9);
  const security = Math.min(1, Math.max(0, (sector.tags.includes("high_patrol") ? 0.7 : 0.3) + rng.range(-0.2, 0.3)));

  const economy: EconomyProfile = { wealth, industry, security };

  const storyAnchorChance = rng.range(0.02, 0.12) * (sector.tags.includes("ruins") ? 1.5 : 1);

  const localPos = sysEntry.localPos;
  const galaxyPos: Vec3f = [
    sector.coord[0] + localPos[0],
    sector.coord[1] + localPos[1],
    sector.coord[2] + localPos[2]
  ];

  return {
    id: sysEntry.id,
    seed: systemSeed,
    sectorId: sector.id,
    sectorCoord: sector.coord,
    localPos,
    galaxyPos,
    archetypeId: archetype.id,
    tags: archetype.tags,
    starClass,
    planetCount,
    poiDensity,
    controllingFaction: sector.controllingFaction,
    economy,
    storyAnchorChance
  };
}


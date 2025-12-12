import {
  ERA_IDS,
  FACTION_IDS,
  SECTOR_ARCHETYPES,
  type SectorArchetype,
  type EraId,
  type FactionId
} from "@xwingz/data";
import { createRng, deriveSeed, type Seed } from "../seed";
import { normalizeWeights, type GenCtx, type SectorDef, type Vec3i } from "./types";

function pickArchetype(seed: Seed): SectorArchetype {
  const rng = createRng(seed);
  return rng.pick(SECTOR_ARCHETYPES);
}

export function getSector(coord: Vec3i, ctx: GenCtx): SectorDef {
  const [x, y, z] = coord;
  const sectorSeed = deriveSeed(ctx.globalSeed, "sector", x, y, z);
  const rng = createRng(sectorSeed);

  const archetype = pickArchetype(sectorSeed);
  const eraEcho = normalizeWeights<EraId>(archetype.eraEchoWeights, ERA_IDS, rng);
  const factionField = normalizeWeights<FactionId>(archetype.factionWeights, FACTION_IDS, rng);
  const controllingFaction = rng.weightedPick(
    FACTION_IDS.map((id) => [id, factionField[id]]) as Array<[FactionId, number]>
  );

  const systemCount = Math.floor(rng.range(archetype.systemCountRange[0], archetype.systemCountRange[1] + 1));
  const hazardScalar = rng.range(archetype.hazardScalarRange[0], archetype.hazardScalarRange[1]);

  const systems: SectorDef["systems"] = [];
  for (let i = 0; i < systemCount; i++) {
    const systemSeed = deriveSeed(sectorSeed, "system", i);
    const srng = createRng(systemSeed);
    systems.push({
      id: `sys_${x}_${y}_${z}_${i}`,
      seed: systemSeed,
      localPos: [srng.nextF01(), srng.nextF01(), srng.nextF01()]
    });
  }

  return {
    id: `sector_${x}_${y}_${z}`,
    coord,
    seed: sectorSeed,
    archetypeId: archetype.id,
    tags: archetype.tags,
    eraEcho,
    factionField,
    controllingFaction,
    hazardScalar,
    systemCount,
    systems
  };
}


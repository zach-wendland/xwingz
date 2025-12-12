import type { FactionId } from "@xwingz/data";
import { createRng, deriveSeed, type Seed } from "./seed";
import type { SystemDef } from "./galaxy/system";

export type MissionType = "bounty";

export type MissionDef = {
  id: string;
  seed: Seed;
  tier: number;
  type: MissionType;
  title: string;
  description: string;
  systemId: string;
  controllingFaction: FactionId;
  goalKills: number;
  rewardCredits: number;
};

export function getMission(system: SystemDef, tier = 0): MissionDef {
  const seed = deriveSeed(system.seed, "mission", tier);
  const rng = createRng(seed);

  const density = system.poiDensity ?? 0.5;
  const wealth = system.economy?.wealth ?? 0.5;

  const baseKills = 6 + Math.round(density * 10);
  const tierKills = Math.floor(tier * 1.25);
  const jitter = Math.round(rng.range(-2, 3));
  const goalKills = clampInt(baseKills + tierKills + jitter, 6, 36);

  const perKill = 35 + Math.round(wealth * 30);
  const tierScalar = 1 + Math.min(0.6, tier * 0.08);
  const rewardCredits = Math.max(100, Math.round(goalKills * perKill * tierScalar));

  const title = "Bounty Contract";
  const description = `Eliminate hostile fighters threatening ${system.id}.`;

  return {
    id: `msn_${system.id}_t${tier}`,
    seed,
    tier,
    type: "bounty",
    title,
    description,
    systemId: system.id,
    controllingFaction: system.controllingFaction,
    goalKills,
    rewardCredits
  };
}

function clampInt(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(v)));
}


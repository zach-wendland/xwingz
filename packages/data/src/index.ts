export const DATA_VERSION = 0;

// ---- ID Sets (v0) ----
export const ERA_IDS = [
  "old_republic",
  "clone_wars",
  "empire",
  "new_republic",
  "first_order"
] as const;
export type EraId = (typeof ERA_IDS)[number];

export const FACTION_IDS = [
  "republic",
  "empire",
  "hutts",
  "pirates",
  "independent",
  "sith_cult",
  "jedi_remnant"
] as const;
export type FactionId = (typeof FACTION_IDS)[number];

export const STAR_CLASS_IDS = ["o", "b", "a", "f", "g", "k", "m", "neutron", "black_hole"] as const;
export type StarClassId = (typeof STAR_CLASS_IDS)[number];

export type SectorArchetype = {
  id: string;
  tags: string[];
  eraEchoWeights: Partial<Record<EraId, number>>;
  factionWeights: Partial<Record<FactionId, number>>;
  systemCountRange: [number, number];
  hazardScalarRange: [number, number];
};

// Small curated set to start. This grows over time; constraints live in procgen.
export const SECTOR_ARCHETYPES: SectorArchetype[] = [
  {
    id: "core_metropolis",
    tags: ["core", "high_patrol", "wealthy"],
    eraEchoWeights: { old_republic: 0.2, clone_wars: 0.2, empire: 0.3, new_republic: 0.3 },
    factionWeights: { republic: 0.35, empire: 0.25, independent: 0.2, jedi_remnant: 0.1 },
    systemCountRange: [10, 18],
    hazardScalarRange: [0.1, 0.4]
  },
  {
    id: "outer_rim_frontier",
    tags: ["frontier", "low_patrol", "smuggler_friendly"],
    eraEchoWeights: { old_republic: 0.15, clone_wars: 0.25, empire: 0.25, new_republic: 0.25, first_order: 0.1 },
    factionWeights: { hutts: 0.25, pirates: 0.25, independent: 0.25, empire: 0.15, republic: 0.1 },
    systemCountRange: [6, 14],
    hazardScalarRange: [0.2, 0.7]
  },
  {
    id: "hutt_space",
    tags: ["criminal", "trade_hub"],
    eraEchoWeights: { old_republic: 0.2, clone_wars: 0.2, empire: 0.3, new_republic: 0.3 },
    factionWeights: { hutts: 0.55, pirates: 0.2, independent: 0.25 },
    systemCountRange: [8, 16],
    hazardScalarRange: [0.2, 0.6]
  },
  {
    id: "war_scarred_remnant",
    tags: ["battlefields", "ruins", "dangerous"],
    eraEchoWeights: { clone_wars: 0.5, empire: 0.3, old_republic: 0.2 },
    factionWeights: { pirates: 0.35, empire: 0.25, independent: 0.25, sith_cult: 0.15 },
    systemCountRange: [5, 10],
    hazardScalarRange: [0.5, 0.9]
  }
];

export type SystemArchetype = {
  id: string;
  tags: string[];
  starClassWeights: Partial<Record<StarClassId, number>>;
  planetCountRange: [number, number];
  poiDensityRange: [number, number];
};

export const SYSTEM_ARCHETYPES: SystemArchetype[] = [
  {
    id: "trade_lane_hub",
    tags: ["trade", "high_traffic"],
    starClassWeights: { g: 0.2, k: 0.2, f: 0.2, m: 0.2, a: 0.2 },
    planetCountRange: [4, 9],
    poiDensityRange: [0.6, 1.0]
  },
  {
    id: "smuggler_hideout",
    tags: ["smuggler", "low_patrol"],
    starClassWeights: { m: 0.4, k: 0.3, g: 0.2, neutron: 0.1 },
    planetCountRange: [2, 6],
    poiDensityRange: [0.3, 0.7]
  },
  {
    id: "dead_system",
    tags: ["haunted", "anomaly"],
    starClassWeights: { black_hole: 0.3, neutron: 0.3, m: 0.4 },
    planetCountRange: [0, 3],
    poiDensityRange: [0.2, 0.5]
  }
];

// ---- Space Combat Archetypes (v0) ----
export type FighterArchetypeId = "xwing_player" | "tie_ln" | "z95" | "pirate_fang";

export type FighterArchetype = {
  id: FighterArchetypeId;
  tags: string[];
  factionTag: FactionId;
  maxSpeed: number;
  accel: number;
  turnRate: number;
  weaponCooldown: number;
  projectileSpeed: number;
  damage: number;
  hp: number;
  hitRadius: number;
  aggression: number; // 0..1
  evadeBias: number;  // 0..1
};

export const FIGHTER_ARCHETYPES: FighterArchetype[] = [
  {
    id: "xwing_player",
    tags: ["player", "rebel"],
    factionTag: "republic",
    maxSpeed: 260,
    accel: 130,
    turnRate: 1.35,
    weaponCooldown: 0.11,
    projectileSpeed: 950,
    damage: 10,
    hp: 120,
    hitRadius: 10,
    aggression: 0.5,
    evadeBias: 0.4
  },
  {
    id: "tie_ln",
    tags: ["fighter", "imperial"],
    factionTag: "empire",
    maxSpeed: 280,
    accel: 140,
    turnRate: 1.55,
    weaponCooldown: 0.14,
    projectileSpeed: 900,
    damage: 9,
    hp: 70,
    hitRadius: 9,
    aggression: 0.75,
    evadeBias: 0.35
  },
  {
    id: "z95",
    tags: ["fighter", "scrappy"],
    factionTag: "independent",
    maxSpeed: 230,
    accel: 110,
    turnRate: 1.1,
    weaponCooldown: 0.18,
    projectileSpeed: 820,
    damage: 8,
    hp: 90,
    hitRadius: 10,
    aggression: 0.6,
    evadeBias: 0.5
  },
  {
    id: "pirate_fang",
    tags: ["fighter", "pirate"],
    factionTag: "pirates",
    maxSpeed: 250,
    accel: 120,
    turnRate: 1.25,
    weaponCooldown: 0.16,
    projectileSpeed: 860,
    damage: 8,
    hp: 85,
    hitRadius: 10,
    aggression: 0.65,
    evadeBias: 0.6
  }
];

import type { FactionId } from "./index";

export type PlanetStyleId = "desert" | "ice" | "jungle" | "ocean" | "volcanic" | "city" | "gas" | "barren" | "mystic";

export type PlanetDef = {
  id: string;
  name: string;
  faction: FactionId;
  style: PlanetStyleId;
  position: [number, number]; // Map grid position (circular layout)
  economy: { wealth: number; industry: number; security: number };
  missionType: "bounty" | "defense" | "assault" | "patrol";
  tags: string[];
  description: string;
};

/**
 * 10 iconic Star Wars planets for the fixed galaxy map.
 * Arranged in a circular pattern around Yavin 4 at center.
 */
export const PLANETS: PlanetDef[] = [
  {
    id: "yavin_4",
    name: "Yavin 4",
    faction: "republic",
    style: "jungle",
    position: [0, 0],
    economy: { wealth: 0.55, industry: 0.6, security: 0.85 },
    missionType: "defense",
    tags: ["jungle", "rebel_base", "massassi_temple"],
    description: "Ancient jungle moon. Home of the Rebel Alliance base."
  },
  {
    id: "tatooine",
    name: "Tatooine",
    faction: "hutts",
    style: "desert",
    position: [2, 0],
    economy: { wealth: 0.3, industry: 0.4, security: 0.2 },
    missionType: "bounty",
    tags: ["desert", "outer_rim", "smuggler_friendly"],
    description: "Twin-sunned desert world. Wretched hive of scum and villainy."
  },
  {
    id: "hoth",
    name: "Hoth",
    faction: "republic",
    style: "ice",
    position: [1, 1.7],
    economy: { wealth: 0.2, industry: 0.3, security: 0.7 },
    missionType: "defense",
    tags: ["ice", "outer_rim", "rebel_base"],
    description: "Frozen wasteland. Site of Echo Base."
  },
  {
    id: "coruscant",
    name: "Coruscant",
    faction: "empire",
    style: "city",
    position: [-1, 1.7],
    economy: { wealth: 0.95, industry: 0.9, security: 0.95 },
    missionType: "assault",
    tags: ["city", "core", "capital"],
    description: "Galactic capital. Planet-wide city of endless towers."
  },
  {
    id: "endor",
    name: "Endor",
    faction: "republic",
    style: "jungle",
    position: [-2, 0],
    economy: { wealth: 0.35, industry: 0.2, security: 0.5 },
    missionType: "assault",
    tags: ["forest", "outer_rim", "ewoks"],
    description: "Forest moon. Home of the Ewoks and the second Death Star."
  },
  {
    id: "dagobah",
    name: "Dagobah",
    faction: "independent",
    style: "mystic",
    position: [-1, -1.7],
    economy: { wealth: 0.1, industry: 0.1, security: 0.1 },
    missionType: "patrol",
    tags: ["swamp", "outer_rim", "force_nexus"],
    description: "Swamp world strong in the Force. Yoda's refuge."
  },
  {
    id: "bespin",
    name: "Bespin",
    faction: "independent",
    style: "gas",
    position: [1, -1.7],
    economy: { wealth: 0.7, industry: 0.8, security: 0.4 },
    missionType: "bounty",
    tags: ["gas_giant", "tibanna", "cloud_city"],
    description: "Gas giant with Cloud City. Tibanna gas mining."
  },
  {
    id: "mustafar",
    name: "Mustafar",
    faction: "empire",
    style: "volcanic",
    position: [1.8, 1],
    economy: { wealth: 0.5, industry: 0.85, security: 0.8 },
    missionType: "assault",
    tags: ["volcanic", "outer_rim", "separatist"],
    description: "Volcanic hellscape. Site of Vader's castle."
  },
  {
    id: "scarif",
    name: "Scarif",
    faction: "empire",
    style: "ocean",
    position: [-1.8, 1],
    economy: { wealth: 0.6, industry: 0.7, security: 0.9 },
    missionType: "assault",
    tags: ["tropical", "imperial_base", "archives"],
    description: "Tropical paradise. Imperial data vault and citadel."
  },
  {
    id: "naboo",
    name: "Naboo",
    faction: "republic",
    style: "ocean",
    position: [0, -2],
    economy: { wealth: 0.8, industry: 0.5, security: 0.7 },
    missionType: "patrol",
    tags: ["pastoral", "mid_rim", "gungans"],
    description: "Idyllic world of rolling hills and underwater cities."
  }
];

/**
 * Helper to convert PlanetDef to SystemDef shape for compatibility.
 * Positions are scaled for nice map spread (position * 0.15 maps to galaxy units).
 */
export function planetToSystem(planet: PlanetDef) {
  const POSITION_SCALE = 0.18; // Spread planets nicely on map
  const x = planet.position[0] * POSITION_SCALE;
  const z = planet.position[1] * POSITION_SCALE;
  return {
    id: planet.id,
    seed: BigInt(planet.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 12345),
    sectorId: "fixed",
    sectorCoord: [0, 0, 0] as [number, number, number],
    localPos: [x, 0, z] as [number, number, number],
    galaxyPos: [x, 0, z] as [number, number, number],
    archetypeId: planet.style,
    tags: planet.tags,
    starClass: "g" as const,
    planetCount: 1,
    poiDensity: 0.5,
    controllingFaction: planet.faction,
    economy: planet.economy,
    storyAnchorChance: planet.id === "yavin_4" ? 1 : 0.1
  };
}

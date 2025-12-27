/**
 * ConquestConstants - Shared constants for conquest mode
 */

import { CONQUEST_FACTION } from "@xwingz/gameplay";

export const GALAXY_SCALE = 1000;

// Faction colors (Empire uses Imperial blue/gray per Star Wars canon)
export const FACTION_COLORS = {
  [CONQUEST_FACTION.NEUTRAL]: 0x888888,
  [CONQUEST_FACTION.REBEL]: 0xff6644,
  [CONQUEST_FACTION.EMPIRE]: 0x4488ff  // Imperial blue (green reserved for lasers)
} as const;

export const FACTION_GLOW = {
  [CONQUEST_FACTION.NEUTRAL]: 0x444444,
  [CONQUEST_FACTION.REBEL]: 0xff2200,
  [CONQUEST_FACTION.EMPIRE]: 0x2266ff  // Imperial blue glow
} as const;
